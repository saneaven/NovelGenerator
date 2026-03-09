from __future__ import annotations

import functools
import re
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

from jinja2 import BaseLoader, StrictUndefined, TemplateNotFound, nodes
from jinja2.environment import Environment, Template
from jinja2.exceptions import TemplateSyntaxError, UndefinedError
from jinja2.sandbox import ImmutableSandboxedEnvironment, SecurityError
from jinja2.visitor import NodeVisitor


MAX_TEMPLATE_DEPTH = 10
MAX_TEMPLATE_RESOLUTION_COUNT = 64


class FragmentNotFoundError(RuntimeError):
    def __init__(self, path: str) -> None:
        self.path = path
        super().__init__(path)


class TemplateRenderLimitError(RuntimeError):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


@dataclass
class RenderBudget:
    stack: list[str] = field(default_factory=list)
    resolution_count: int = 0

    def enter_template(self, name: str) -> None:
        if len(self.stack) >= MAX_TEMPLATE_DEPTH:
            raise TemplateRenderLimitError("depth")
        self.stack.append(name)

    def exit_template(self) -> None:
        if self.stack:
            self.stack.pop()

    def note_resolution(self, _name: str) -> None:
        self.resolution_count += 1
        if self.resolution_count > MAX_TEMPLATE_RESOLUTION_COUNT:
            raise TemplateRenderLimitError("count")


@dataclass(frozen=True)
class LiteralIncludeReference:
    name: str
    ignore_missing: bool


@dataclass
class TemplateValidationReport:
    errors: list[str]
    warnings: list[str]
    referenced_fragments: list[str]


_current_budget: ContextVar[RenderBudget | None] = ContextVar("template_budget", default=None)


def _to_fragment_reference(name: str) -> str:
    return f"fragment:{name}"


def _normalize_fragment_storage_key(value: str) -> str:
    raw = str(value).strip().replace("\\", "/")
    if raw.startswith("fragment:"):
        raw = raw.split(":", 1)[1]
    raw = raw.strip("/")
    if raw.endswith(".md"):
        raw = raw[:-3]
    return raw


def _normalize_fragment_reference(raw: str) -> str:
    value = str(raw).strip()
    if not value.startswith("fragment:"):
        raise TemplateNotFound(value)
    name = value.split(":", 1)[1].replace("\\", "/").strip("/")
    if not name or name.endswith(".md"):
        raise TemplateNotFound(value)
    parts = name.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise TemplateNotFound(value)
    if ":" in name:
        raise TemplateNotFound(value)
    return name


def _fragment_reference_from_exception(exc: TemplateNotFound) -> str:
    raw = str(getattr(exc, "name", "") or str(exc))
    try:
        return _to_fragment_reference(_normalize_fragment_reference(raw))
    except TemplateNotFound:
        return raw


class _TemplateReferenceCollector(NodeVisitor):
    def __init__(self) -> None:
        self.include_refs: list[LiteralIncludeReference] = []
        self.has_prompt_call = False

    def visit_Include(self, node: nodes.Include, *args: Any, **kwargs: Any) -> None:
        template_node = node.template
        if isinstance(template_node, nodes.Const) and isinstance(template_node.value, str):
            self.include_refs.append(
                LiteralIncludeReference(
                    name=template_node.value,
                    ignore_missing=bool(node.ignore_missing),
                )
            )
        self.generic_visit(node, *args, **kwargs)

    def visit_Call(self, node: nodes.Call, *args: Any, **kwargs: Any) -> None:
        callee = node.node
        if isinstance(callee, nodes.Name) and callee.name == "prompt":
            self.has_prompt_call = True
        self.generic_visit(node, *args, **kwargs)


def _analyze_template_ast(ast: nodes.Template) -> tuple[list[LiteralIncludeReference], bool]:
    collector = _TemplateReferenceCollector()
    collector.visit(ast)
    return collector.include_refs, collector.has_prompt_call


def _parse_template(
    env: Environment,
    template_text: str,
) -> tuple[nodes.Template, list[LiteralIncludeReference], bool]:
    ast = env.parse(template_text)
    include_refs, has_prompt_call = _analyze_template_ast(ast)
    return ast, include_refs, has_prompt_call


def _build_dependency_map(
    env: Environment,
    fragment_map: Mapping[str, str],
    *,
    override_name: str | None,
    override_content: str | None,
) -> tuple[dict[str, list[str]], list[str]]:
    dependencies: dict[str, list[str]] = {}
    errors: list[str] = []
    cache: dict[str, list[LiteralIncludeReference]] = {}

    def get_content(name: str) -> str | None:
        if override_name is not None and name == override_name:
            return override_content
        return fragment_map.get(name)

    def collect(name: str) -> list[LiteralIncludeReference]:
        if name in cache:
            return cache[name]
        content = get_content(name)
        if content is None:
            cache[name] = []
            return []
        try:
            _, refs, has_prompt_call = _parse_template(env, content)
        except TemplateSyntaxError as exc:
            errors.append(f"Invalid fragment syntax in {_to_fragment_reference(name)}: {exc.message}")
            cache[name] = []
            return []
        if has_prompt_call:
            errors.append(f"Unsupported prompt() call in {_to_fragment_reference(name)}")
        cache[name] = refs
        return refs

    names_to_visit = set(fragment_map.keys())
    if override_name:
        names_to_visit.add(override_name)

    pending = list(names_to_visit)
    while pending:
        name = pending.pop()
        next_names: list[str] = []
        for ref in collect(name):
            try:
                normalized = _normalize_fragment_reference(ref.name)
            except TemplateNotFound:
                continue
            next_names.append(normalized)
            if normalized not in dependencies and normalized not in pending:
                pending.append(normalized)
        dependencies[name] = next_names

    return dependencies, errors


def _find_cycle(
    root_deps: Iterable[str],
    dependency_map: Mapping[str, list[str]],
) -> list[str] | None:
    visited: set[str] = set()
    stack: list[str] = []
    on_stack: set[str] = set()

    def dfs(name: str) -> list[str] | None:
        if name in on_stack:
            idx = stack.index(name)
            return stack[idx:] + [name]
        if name in visited:
            return None
        visited.add(name)
        stack.append(name)
        on_stack.add(name)
        for dep in dependency_map.get(name, []):
            cycle = dfs(dep)
            if cycle is not None:
                return cycle
        on_stack.remove(name)
        stack.pop()
        return None

    for dep in root_deps:
        cycle = dfs(dep)
        if cycle is not None:
            return cycle
    return None


class BudgetedTemplate(Template):
    @classmethod
    def from_code(
        cls,
        environment: Environment,
        code: Any,
        globals: dict[str, Any],
        uptodate: Any = None,
    ) -> "BudgetedTemplate":
        namespace = {"environment": environment, "__file__": code.co_filename}
        exec(code, namespace)
        rv = cls._from_namespace(environment, namespace, globals)
        rv._uptodate = uptodate

        root_render_func = rv.root_render_func

        @functools.wraps(root_render_func)
        def guarded_root_render_func(context: Any, *args: Any, **kwargs: Any):
            budget = _current_budget.get()
            template_name = str(rv.name or "<string>")
            if budget is None:
                yield from root_render_func(context, *args, **kwargs)
                return
            budget.enter_template(template_name)
            try:
                yield from root_render_func(context, *args, **kwargs)
            finally:
                budget.exit_template()

        rv.root_render_func = guarded_root_render_func
        return rv


class PromptSandbox(ImmutableSandboxedEnvironment):
    template_class = BudgetedTemplate

    def is_safe_attribute(self, obj: Any, attr: Any, value: Any) -> bool:
        if not isinstance(attr, str):
            return False
        if attr.startswith("_"):
            return False
        return super().is_safe_attribute(obj, attr, value)

    def _load_template(self, name: str, globals: dict[str, Any] | None) -> Template:
        budget = _current_budget.get()
        if budget is not None:
            budget.note_resolution(str(name))
        return super()._load_template(name, globals)


class FragmentLoader(BaseLoader):
    def __init__(self, fragment_map: Mapping[str, str] | None = None) -> None:
        source = fragment_map or {}
        self._fragment_map = {
            _normalize_fragment_storage_key(key): value
            for key, value in source.items()
        }

    def get_source(self, environment: Environment, template: str):
        key = _normalize_fragment_reference(template)
        source = self._fragment_map.get(key)
        if source is None:
            raise TemplateNotFound(_to_fragment_reference(key))

        def is_up_to_date() -> bool:
            return True

        return source, _to_fragment_reference(key), is_up_to_date


def _filter_by_type(items: Any, type_name: str) -> list[Any]:
    if not isinstance(items, list):
        return []
    return [x for x in items if isinstance(x, dict) and x.get("type") == type_name]


def _filter_by_ids(items: Any, ids: Any) -> list[Any]:
    if not isinstance(items, list) or not isinstance(ids, list):
        return []
    wanted = set(str(v) for v in ids)
    return [x for x in items if isinstance(x, dict) and str(x.get("id")) in wanted]


def _get_by_id(items: Any, item_id: Any) -> Any:
    if not isinstance(items, list):
        return None
    sid = str(item_id)
    for x in items:
        if isinstance(x, dict) and str(x.get("id")) == sid:
            return x
    return None


def _get_manuscript(items: Any, chapter_id: Any) -> Any:
    if not isinstance(items, list):
        return None
    sid = str(chapter_id)
    for x in items:
        if isinstance(x, dict) and str(x.get("chapterId")) == sid:
            return x
    return None


def _ids_set(ids: Any) -> set[str] | None:
    if not isinstance(ids, list):
        return None
    return {str(v) for v in ids}


def _get_objects_of_language(project: dict[str, Any], lang: str, ids: Any = None) -> list[dict[str, Any]]:
    if not isinstance(project, dict):
        return []
    lang_objects: list[dict[str, Any]] = []
    languages = project.get("contentByLang")
    if isinstance(languages, dict):
        lang_bucket = languages.get(lang)
        if isinstance(lang_bucket, dict) and isinstance(lang_bucket.get("objects"), list):
            lang_objects = [x for x in lang_bucket["objects"] if isinstance(x, dict)]
    if not lang_objects:
        objs = project.get("objects")
        if isinstance(objs, list):
            lang_objects = [x for x in objs if isinstance(x, dict)]

    wanted = _ids_set(ids)
    if wanted is None:
        return lang_objects
    return [x for x in lang_objects if str(x.get("id")) in wanted]


def _get_manuscripts_of_language(project: dict[str, Any], lang: str, ids: Any = None) -> list[dict[str, Any]]:
    if not isinstance(project, dict):
        return []
    manuscripts: list[dict[str, Any]] = []
    languages = project.get("contentByLang")
    if isinstance(languages, dict):
        lang_bucket = languages.get(lang)
        if isinstance(lang_bucket, dict) and isinstance(lang_bucket.get("manuscripts"), list):
            manuscripts = [x for x in lang_bucket["manuscripts"] if isinstance(x, dict)]
    if not manuscripts:
        values = project.get("manuscripts")
        if isinstance(values, list):
            manuscripts = [x for x in values if isinstance(x, dict)]

    wanted = _ids_set(ids)
    if wanted is None:
        return manuscripts
    return [x for x in manuscripts if str(x.get("id")) in wanted]


def create_environment(fragment_map: Mapping[str, str] | None = None) -> Environment:
    env = PromptSandbox(
        loader=FragmentLoader(fragment_map=fragment_map),
        autoescape=False,
        undefined=StrictUndefined,
        trim_blocks=False,
        lstrip_blocks=False,
    )

    env.filters["filter_by_type"] = _filter_by_type
    env.filters["filter_by_ids"] = _filter_by_ids
    env.filters["get_by_id"] = _get_by_id
    env.filters["get_manuscript"] = _get_manuscript

    env.globals["get_objects_of_language"] = _get_objects_of_language
    env.globals["get_manuscripts_of_language"] = _get_manuscripts_of_language

    return env


def validate_template_source(
    template_text: str,
    *,
    fragment_map: Mapping[str, str] | None = None,
    current_template_path: str | None = None,
) -> TemplateValidationReport:
    normalized_fragment_map = {
        _normalize_fragment_storage_key(key): value
        for key, value in (fragment_map or {}).items()
    }
    env = create_environment(fragment_map=normalized_fragment_map)
    errors: list[str] = []
    warnings: list[str] = []
    referenced_fragments: list[str] = []

    _ast, include_refs, has_prompt_call = _parse_template(env, template_text)
    if has_prompt_call:
        errors.append("prompt() is no longer supported. Use {% include \"fragment:...\" %}.")

    override_name = _normalize_fragment_storage_key(current_template_path) if current_template_path else None

    normalized_root_deps: list[str] = []
    seen_refs: set[str] = set()
    for ref in include_refs:
        if ref.name not in seen_refs:
            referenced_fragments.append(ref.name)
            seen_refs.add(ref.name)
        try:
            normalized_name = _normalize_fragment_reference(ref.name)
        except TemplateNotFound:
            if not ref.ignore_missing:
                errors.append(f"Referenced fragment not found: {ref.name}")
            continue
        normalized_root_deps.append(normalized_name)
        if ref.ignore_missing:
            continue
        if normalized_name not in normalized_fragment_map and normalized_name != override_name:
            errors.append(f"Referenced fragment not found: {_to_fragment_reference(normalized_name)}")
    dependency_map, dependency_errors = _build_dependency_map(
        env,
        normalized_fragment_map,
        override_name=override_name,
        override_content=template_text if override_name else None,
    )
    errors.extend(dependency_errors)

    cycle = _find_cycle(normalized_root_deps, dependency_map)
    if cycle is not None:
        cycle_path = " -> ".join(_to_fragment_reference(name) for name in cycle)
        errors.append(f"Circular fragment reference detected: {cycle_path}")

    deduped_errors = list(dict.fromkeys(errors))
    deduped_warnings = list(dict.fromkeys(warnings))
    deduped_refs = list(dict.fromkeys(referenced_fragments))
    return TemplateValidationReport(
        errors=deduped_errors,
        warnings=deduped_warnings,
        referenced_fragments=deduped_refs,
    )


def render_template(env: Environment, template_text: str, data: dict[str, Any]) -> str:
    budget = RenderBudget()
    token = _current_budget.set(budget)
    try:
        template = env.from_string(template_text)
        rendered = template.render(**data)
        return rendered
    except TemplateNotFound as exc:
        raise FragmentNotFoundError(_fragment_reference_from_exception(exc)) from exc
    finally:
        _current_budget.reset(token)


def format_template_error(exc: Exception) -> str:
    if isinstance(exc, FragmentNotFoundError):
        return f"Referenced fragment not found: {exc.path}"
    if isinstance(exc, TemplateRenderLimitError):
        return "Template rendering exceeded safe limits."
    if isinstance(exc, SecurityError):
        return "Template contains a disallowed expression."
    if isinstance(exc, TemplateSyntaxError):
        return exc.message
    if isinstance(exc, UndefinedError):
        return str(exc)
    return "Template rendering failed."


# Default prompt conversion helpers (Handlebars -> Jinja2)
_RE_PROMPT_HELPER = re.compile(r"\{\{\s*prompt\s+\"([^\"]+)\"\s*\}\}")
_RE_EACH = re.compile(r"\{\{#each\s+([^\s\}]+)(?:\s+as\s+\|([^\|]+)\|)?\s*\}\}")
_RE_END_EACH = re.compile(r"\{\{/each\s*\}\}")
_RE_IF = re.compile(r"\{\{#if\s+([^\}]+)\}\}")
_RE_ELSE = re.compile(r"\{\{else\s*\}\}")
_RE_END_IF = re.compile(r"\{\{/if\s*\}\}")
_RE_VAR = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_\.\[\]-]*)\s*\}\}")


def convert_handlebars_to_jinja(text: str) -> str:
    out = text

    out = _RE_PROMPT_HELPER.sub(
        lambda m: '{% include "fragment:' + m.group(1).strip() + '" %}',
        out,
    )

    def each_repl(match: re.Match[str]) -> str:
        items = match.group(1).strip()
        alias = (match.group(2) or "item").strip()
        return f"{{% for {alias} in {items} %}}"

    out = _RE_EACH.sub(each_repl, out)
    out = _RE_END_EACH.sub("{% endfor %}", out)

    out = _RE_IF.sub(lambda m: "{% if " + m.group(1).strip() + " %}", out)
    out = _RE_ELSE.sub("{% else %}", out)
    out = _RE_END_IF.sub("{% endif %}", out)

    replacements = {
        "filterByType": "filter_by_type",
        "filterByIds": "filter_by_ids",
        "getById": "get_by_id",
        "getManuscript": "get_manuscript",
    }
    for hb, _j2 in replacements.items():
        out = re.sub(
            r"\{\{\s*" + hb + r"\s+([^\}]+)\}\}",
            lambda m: "{{ " + m.group(1).replace(hb, "").strip().replace(" ", "|") + " }}",
            out,
        )

    out = _RE_VAR.sub(lambda m: "{{ " + m.group(1).strip() + " }}", out)

    return out

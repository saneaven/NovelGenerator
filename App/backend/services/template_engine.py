from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from jinja2 import BaseLoader, Environment, StrictUndefined, TemplateNotFound, pass_context


BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "prompts" / "templates"
FRAGMENTS_DIR = BASE_DIR / "prompts" / "default_fragments"
MAX_INCLUDE_DEPTH = 10


class FragmentNotFoundError(RuntimeError):
    def __init__(self, path: str) -> None:
        self.path = path
        super().__init__(f"FRAGMENT_NOT_FOUND::{path}")


class TemplateIncludeDepthExceededError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("TEMPLATE_INCLUDE_DEPTH_EXCEEDED")


def _normalize_fragment_key(value: str) -> str:
    raw = value.strip().replace("\\", "/").lstrip("/")
    if raw.endswith(".md"):
        raw = raw[:-3]
    return raw


class FragmentLoader(BaseLoader):
    def __init__(self, fragment_map: dict[str, str] | None = None) -> None:
        source = fragment_map or {}
        self._fragment_map = {_normalize_fragment_key(k): v for k, v in source.items()}

    def get_source(self, environment: Environment, template: str):
        if not template.startswith("fragment:"):
            raise TemplateNotFound(template)

        key = _normalize_fragment_key(template.split(":", 1)[1])
        source = self._fragment_map.get(key)
        if source is None:
            raise TemplateNotFound(f"fragment:{key}")

        def is_up_to_date() -> bool:
            return True

        return source, f"fragment:{key}", is_up_to_date


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
    languages = project.get("languages")
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
    languages = project.get("languages")
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


@pass_context
def _prompt(context: Any, fragment_name: str, **kwargs: Any) -> str:
    depth = context.parent.get("_prompt_depth", 0) + 1
    if depth > MAX_INCLUDE_DEPTH:
        raise TemplateIncludeDepthExceededError()
    env = context.environment
    template = env.get_template(f"fragment:{fragment_name}")
    data = dict(context.parent)
    data.update(context.vars)
    data.update(kwargs)
    data["_prompt_depth"] = depth
    return template.render(**data)


def create_environment(fragment_map: dict[str, str] | None = None) -> Environment:
    env = Environment(
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
    env.globals["prompt"] = _prompt

    return env


def render_template(env: Environment, template_text: str, data: dict[str, Any]) -> str:
    try:
        template = env.from_string(template_text)
        return template.render(**data)
    except TemplateNotFound as exc:
        raw = str(getattr(exc, "name", "") or str(exc))
        if ":" in raw:
            prefix, remainder = raw.split(":", 1)
            if prefix in {"fragment", "template"}:
                raw = remainder
        raise FragmentNotFoundError(_normalize_fragment_key(raw)) from exc


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

    out = _RE_PROMPT_HELPER.sub(lambda m: '{{ prompt("' + m.group(1).strip() + '") }}', out)

    def each_repl(match: re.Match[str]) -> str:
        items = match.group(1).strip()
        alias = (match.group(2) or "item").strip()
        return f"{{% for {alias} in {items} %}}"

    out = _RE_EACH.sub(each_repl, out)
    out = _RE_END_EACH.sub("{% endfor %}", out)

    out = _RE_IF.sub(lambda m: "{% if " + m.group(1).strip() + " %}", out)
    out = _RE_ELSE.sub("{% else %}", out)
    out = _RE_END_IF.sub("{% endif %}", out)

    # Handlebars helper -> Jinja equivalents (limited deterministic replacements)
    replacements = {
        "filterByType": "filter_by_type",
        "filterByIds": "filter_by_ids",
        "getById": "get_by_id",
        "getManuscript": "get_manuscript",
    }
    for hb, j2 in replacements.items():
        out = re.sub(r"\{\{\s*" + hb + r"\s+([^\}]+)\}\}", lambda m: "{{ " + m.group(1).replace(hb, "").strip().replace(" ", "|") + " }}", out)

    # tighten simple variables
    out = _RE_VAR.sub(lambda m: "{{ " + m.group(1).strip() + " }}", out)

    return out

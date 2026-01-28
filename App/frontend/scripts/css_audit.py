from __future__ import annotations

import argparse
import bisect
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


CODE_EXTS = {".ts", ".tsx", ".js", ".jsx"}

IMPORT_RE = re.compile(
    r"""\bimport\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]""",
    flags=re.M,
)
EXPORT_FROM_RE = re.compile(
    r"""\bexport\s+(?:type\s+)?(?:\*\s*(?:as\s+\w+\s*)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]""",
    flags=re.M,
)
DYNAMIC_IMPORT_RE = re.compile(r"""\bimport\(\s*['"]([^'"]+)['"]\s*\)""")
REQUIRE_RE = re.compile(r"""\brequire\(\s*['"]([^'"]+)['"]\s*\)""")

CSS_IMPORT_RE = re.compile(r"""@import\s+(?:url\()?\s*['"]([^'"]+)['"]\s*\)?\s*;""")

TOKEN_RE = re.compile(r"[A-Za-z0-9_-]+")
STRING_RE = re.compile(r"""('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)""", flags=re.S)
DATA_ATTR_RE = re.compile(r"\bdata-[A-Za-z0-9_-]+\b")

CLASS_RE = re.compile(r"\.([_a-zA-Z][-_a-zA-Z0-9]*)")
ID_RE = re.compile(r"#([_a-zA-Z][-_a-zA-Z0-9]*)")
DATA_ATTR_SEL_RE = re.compile(r"\[\s*(data-[a-zA-Z0-9_-]+)")

UNION_PROP_RE = re.compile(
    r"""\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\??\s*:\s*((?:'[^']+'|"[^"]+")(?:\s*\|\s*(?:'[^']+'|"[^"]+"))+)\s*;""",
    flags=re.M,
)

ASSIGN_STRING_RE = re.compile(
    r"""\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:'([^']+)'|"([^"]+)")""",
    flags=re.M,
)

BRACED_ASSIGN_STRING_RE = re.compile(
    r"""\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{\s*(?:'([^']+)'|"([^"]+)")\s*\}""",
    flags=re.M,
)

DEFAULT_EXPORT_IDENT_RE = re.compile(r"""\bexport\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*;""", flags=re.M)
DEFAULT_EXPORT_FUNCTION_RE = re.compile(
    r"""\bexport\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b""",
    flags=re.M,
)
DEFAULT_EXPORT_CLASS_RE = re.compile(
    r"""\bexport\s+default\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b""",
    flags=re.M,
)

TEMPLATE_LITERAL_RE = re.compile(r"`(?:\\.|[^`])*`", flags=re.S)
TEMPLATE_SINGLE_PLACEHOLDER_RE = re.compile(
    r"""^(?P<prefix>.*?)\${\s*(?P<var>[A-Za-z_$][A-Za-z0-9_$]*)\s*}(?P<suffix>.*?)$""",
    flags=re.S,
)
SAFE_TOKEN_FRAGMENT_RE = re.compile(r"^[A-Za-z0-9_-]*$")

AT_KEYFRAMES_RE = re.compile(r"@(-[a-z]+-)?keyframes\s+([_a-zA-Z][-_a-zA-Z0-9]*)")
CUSTOM_PROP_DEF_RE = re.compile(r"(^|[;\s{])(--[a-zA-Z0-9_-]+)\s*:")
VAR_USE_RE = re.compile(r"var\(\s*(--[a-zA-Z0-9_-]+)\s*[,) ]")
PERCENT_SEL_RE = re.compile(r"^(?:\d+%|from|to)\b", flags=re.I)
COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", flags=re.S)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def compute_newline_positions(text: str) -> list[int]:
    return [m.start() for m in re.finditer("\n", text)]


def line_for_index(newlines: list[int], idx: int) -> int:
    return bisect.bisect_right(newlines, idx) + 1


def clean_specifier(spec: str) -> str:
    for sep in ("?", "#"):
        if sep in spec:
            spec = spec.split(sep, 1)[0]
    return spec


def resolve_relative(from_path: Path, spec: str) -> Path | None:
    spec = clean_specifier(spec)
    if not spec.startswith("."):
        return None

    candidate = (from_path.parent / spec).resolve()
    if candidate.suffix:
        return candidate if candidate.exists() else None

    for ext in [".ts", ".tsx", ".js", ".jsx", ".css"]:
        p = Path(str(candidate) + ext)
        if p.exists():
            return p

    if candidate.exists() and candidate.is_dir():
        for name in ["index.ts", "index.tsx", "index.js", "index.jsx"]:
            p = candidate / name
            if p.exists():
                return p

    return None


def resolve_css_import(from_path: Path, spec: str) -> Path | None:
    spec = clean_specifier(spec)
    if not spec.startswith("."):
        return None
    p = (from_path.parent / spec).resolve()
    if p.suffix != ".css":
        if not p.suffix:
            p2 = Path(str(p) + ".css")
            if p2.exists():
                return p2
        return p if p.exists() else None
    return p if p.exists() else None


def iter_files(root: Path, exts: set[str]) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file() and p.suffix in exts]


def split_selector_list(selector_text: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    depth_paren = 0
    depth_brack = 0
    in_str: str | None = None
    esc = False
    for ch in selector_text:
        if in_str:
            buf.append(ch)
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
            continue

        if ch in ('"', "'"):
            in_str = ch
            buf.append(ch)
            continue

        if ch == "(":
            depth_paren += 1
            buf.append(ch)
            continue
        if ch == ")":
            depth_paren = max(0, depth_paren - 1)
            buf.append(ch)
            continue
        if ch == "[":
            depth_brack += 1
            buf.append(ch)
            continue
        if ch == "]":
            depth_brack = max(0, depth_brack - 1)
            buf.append(ch)
            continue

        if ch == "," and depth_paren == 0 and depth_brack == 0:
            part = "".join(buf).strip()
            if part:
                parts.append(part)
            buf = []
            continue

        buf.append(ch)

    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def extract_classes(selector: str) -> set[str]:
    return set(CLASS_RE.findall(selector))


def extract_ids(selector: str) -> set[str]:
    return set(ID_RE.findall(selector))


def extract_data_attr_selectors(selector: str) -> set[str]:
    return set(DATA_ATTR_SEL_RE.findall(selector))


def extract_used_tokens_from_code(text: str) -> set[str]:
    tokens: set[str] = set()
    for m in STRING_RE.finditer(text):
        inner = m.group(1)[1:-1]
        for t in TOKEN_RE.findall(inner):
            tokens.add(t)
    return tokens


def extract_data_attrs_from_code(text: str) -> set[str]:
    return set(DATA_ATTR_RE.findall(text))


@dataclass(frozen=True)
class DynamicTemplate:
    prefix: str
    var: str
    suffix: str
    file: Path


def extract_dynamic_templates(text: str, path: Path) -> list[DynamicTemplate]:
    templates: list[DynamicTemplate] = []
    for m in TEMPLATE_LITERAL_RE.finditer(text):
        inner = m.group(0)[1:-1]
        if "${" not in inner:
            continue

        # Only handle single-placeholder templates with simple var names.
        if inner.count("${") != 1:
            continue
        m2 = TEMPLATE_SINGLE_PLACEHOLDER_RE.match(inner)
        if not m2:
            continue

        prefix = m2.group("prefix")
        var = m2.group("var")
        suffix = m2.group("suffix")

        if "${" in prefix or "${" in suffix:
            continue

        # Avoid wildcard templates like `` `${className}` `` which would match almost anything.
        if not prefix and not suffix:
            continue
        if not re.search(r"[A-Za-z0-9]", prefix + suffix):
            continue

        # We only use templates that build a single token (no whitespace, safe charset).
        if any(ch.isspace() for ch in prefix + suffix):
            continue
        if not SAFE_TOKEN_FRAGMENT_RE.match(prefix):
            continue
        if not SAFE_TOKEN_FRAGMENT_RE.match(suffix):
            continue

        templates.append(DynamicTemplate(prefix=prefix, var=var, suffix=suffix, file=path))

    return templates


def norm_one_line(s: str) -> str:
    return " ".join(s.split())


@dataclass(frozen=True)
class CssRule:
    file: Path
    line: int
    selector_text: str


def find_selector_start(raw: str, start: int, end: int) -> int:
    j = start
    while j < end:
        while j < end and raw[j].isspace():
            j += 1
        if j >= end:
            return j
        if raw[j : j + 2] == "/*":
            close = raw.find("*/", j + 2)
            if close == -1:
                return end
            j = close + 2
            continue
        break
    return j


def extract_css_rules_fast(path: Path, raw: str) -> tuple[list[CssRule], set[str], set[str]]:
    newlines = compute_newline_positions(raw)

    keyframes: set[str] = set(m.group(2) for m in AT_KEYFRAMES_RE.finditer(raw))
    custom_props: set[str] = set(m.group(2) for m in CUSTOM_PROP_DEF_RE.finditer(raw))

    rules: list[CssRule] = []

    stack: list[str] = []
    stmt_start = 0
    i = 0
    n = len(raw)
    in_str: str | None = None
    esc = False
    in_comment = False

    def in_keyframes() -> bool:
        return "keyframes" in stack

    while i < n:
        ch = raw[i]
        nxt = raw[i + 1] if i + 1 < n else ""

        if in_comment:
            if ch == "*" and nxt == "/":
                in_comment = False
                i += 2
                continue
            i += 1
            continue

        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
            i += 1
            continue

        if ch == "/" and nxt == "*":
            in_comment = True
            i += 2
            continue

        if ch in ('"', "'"):
            in_str = ch
            i += 1
            continue

        if ch == "{":
            seg_start = stmt_start
            seg_end = i
            sel_start = find_selector_start(raw, seg_start, seg_end)

            header = raw[seg_start:seg_end].strip()
            header = COMMENT_BLOCK_RE.sub("", header).strip()

            if header:
                if header.startswith("@"):
                    if AT_KEYFRAMES_RE.match(header):
                        stack.append("keyframes")
                    else:
                        stack.append("atrule")
                else:
                    if not (in_keyframes() and PERCENT_SEL_RE.match(header)):
                        line = line_for_index(newlines, min(sel_start, n - 1))
                        rules.append(CssRule(file=path, line=line, selector_text=header))
                    stack.append("rule")
            else:
                stack.append("rule")

            stmt_start = i + 1
            i += 1
            continue

        if ch == "}":
            if stack:
                stack.pop()
            stmt_start = i + 1
            i += 1
            continue

        if ch == ";" and not stack:
            stmt_start = i + 1
            i += 1
            continue

        i += 1

    return rules, keyframes, custom_props


@dataclass(frozen=True)
class RuleNote:
    file: Path
    line: int
    selector_text: str
    reason: str
    details: str


EXTERNAL_CLASS_PATTERNS = [
    re.compile(r"^ProseMirror$"),
    re.compile(r"^tiptap$"),
    re.compile(r"^cm-"),
]


def is_external_class(name: str) -> bool:
    return any(p.search(name) for p in EXTERNAL_CLASS_PATTERNS)


def find_default_export_name(text: str) -> str | None:
    m = DEFAULT_EXPORT_IDENT_RE.search(text)
    if m:
        return m.group(1)
    m = DEFAULT_EXPORT_FUNCTION_RE.search(text)
    if m:
        return m.group(1)
    m = DEFAULT_EXPORT_CLASS_RE.search(text)
    if m:
        return m.group(1)
    return None


def iter_jsx_start_tags(text: str, tag_name: str) -> list[str]:
    """Extract raw `<Tag ...>` start tags (best-effort) while skipping `>` inside `{...}`."""
    tags: list[str] = []
    needle = f"<{tag_name}"
    i = 0
    n = len(text)
    while True:
        start = text.find(needle, i)
        if start == -1:
            break

        # Ensure we matched the tag name boundary.
        j = start + len(needle)
        if j < n and (text[j].isalnum() or text[j] in ("_", "$")):
            i = j
            continue

        brace_depth = 0
        in_str: str | None = None
        esc = False
        k = j
        while k < n:
            ch = text[k]

            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == in_str:
                    in_str = None
                k += 1
                continue

            if ch in ("'", '"', "`"):
                in_str = ch
                k += 1
                continue

            if ch == "{":
                brace_depth += 1
                k += 1
                continue
            if ch == "}":
                if brace_depth > 0:
                    brace_depth -= 1
                k += 1
                continue

            if ch == ">" and brace_depth == 0:
                tags.append(text[start : k + 1])
                i = k + 1
                break

            k += 1
        else:
            # No closing '>' found; stop scanning.
            break

    return tags


def is_ident_char(ch: str) -> bool:
    return ch.isalnum() or ch in ("_", "$")


def extract_top_level_string_props(tag_text: str, prop_names: set[str]) -> dict[str, set[str]]:
    """Extract `prop=\"value\"` and `prop={'value'}` from the outer tag only (ignores nested `{...}`)."""
    found: dict[str, set[str]] = defaultdict(set)
    i = 0
    n = len(tag_text)

    brace_depth = 0
    in_str: str | None = None
    esc = False

    def parse_string(quote: str, start_idx: int) -> tuple[str | None, int]:
        j = start_idx
        e = False
        while j < n:
            ch = tag_text[j]
            if e:
                e = False
            elif ch == "\\":
                e = True
            elif ch == quote:
                return tag_text[start_idx:j], j + 1
            j += 1
        return None, n

    def skip_braced_expression(start_idx: int) -> int:
        # start_idx points at '{'
        depth = 0
        j = start_idx
        s: str | None = None
        e = False
        while j < n:
            ch = tag_text[j]
            if s:
                if e:
                    e = False
                elif ch == "\\":
                    e = True
                elif ch == s:
                    s = None
                j += 1
                continue

            if ch in ("'", '"', "`"):
                s = ch
                j += 1
                continue

            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth <= 0:
                    return j + 1
            j += 1
        return n

    while i < n:
        ch = tag_text[i]

        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
            i += 1
            continue

        if ch in ("'", '"', "`"):
            in_str = ch
            i += 1
            continue

        if ch == "{":
            brace_depth += 1
            i += 1
            continue
        if ch == "}":
            if brace_depth > 0:
                brace_depth -= 1
            i += 1
            continue

        if brace_depth != 0:
            i += 1
            continue

        # Top-level scan for prop names
        for prop in prop_names:
            if not tag_text.startswith(prop, i):
                continue
            prev = tag_text[i - 1] if i > 0 else ""
            nxt = tag_text[i + len(prop)] if i + len(prop) < n else ""
            if (prev and is_ident_char(prev)) or (nxt and is_ident_char(nxt)):
                continue

            j = i + len(prop)
            while j < n and tag_text[j].isspace():
                j += 1
            if j >= n or tag_text[j] != "=":
                continue
            j += 1
            while j < n and tag_text[j].isspace():
                j += 1
            if j >= n:
                continue

            if tag_text[j] in ("'", '"'):
                quote = tag_text[j]
                val, next_idx = parse_string(quote, j + 1)
                if val is not None:
                    found[prop].add(val)
                i = next_idx
                break

            if tag_text[j] == "{":
                # Try to read `{ 'value' }` or `{ \"value\" }`
                jj = j + 1
                while jj < n and tag_text[jj].isspace():
                    jj += 1
                if jj < n and tag_text[jj] in ("'", '"'):
                    quote = tag_text[jj]
                    val, _ = parse_string(quote, jj + 1)
                    if val is not None:
                        found[prop].add(val)
                i = skip_braced_expression(j)
                break
        else:
            i += 1

    return found


def main() -> int:
    parser = argparse.ArgumentParser(description="Static CSS usage audit (no deletion).")
    parser.add_argument(
        "--output",
        default=None,
        help="Output report path (default: App/frontend/css-unused-report.md).",
    )
    args = parser.parse_args()

    frontend_dir = Path(__file__).resolve().parents[1]
    repo_dir = frontend_dir.parent.parent
    src_dir = frontend_dir / "src"
    entry = src_dir / "main.tsx"
    index_html = frontend_dir / "index.html"
    output_path = Path(args.output) if args.output else (frontend_dir / "css-unused-report.md")
    if not output_path.is_absolute():
        output_path = (repo_dir / output_path).resolve()

    css_files = sorted(iter_files(src_dir, {".css"}))

    # --- Reachable code graph ---
    code_cache: dict[Path, str] = {}
    css_cache: dict[Path, str] = {}

    def get_code(path: Path) -> str:
        if path not in code_cache:
            code_cache[path] = read_text(path)
        return code_cache[path]

    def get_css(path: Path) -> str:
        if path not in css_cache:
            css_cache[path] = read_text(path)
        return css_cache[path]

    reachable_code: set[Path] = set()
    reachable_css_direct: set[Path] = set()

    queue: list[Path] = [entry]
    while queue:
        cur = queue.pop()
        if cur in reachable_code:
            continue
        if not cur.exists():
            continue
        reachable_code.add(cur)

        text = get_code(cur)
        specs: list[str] = []
        specs.extend(IMPORT_RE.findall(text))
        specs.extend(EXPORT_FROM_RE.findall(text))
        specs.extend(DYNAMIC_IMPORT_RE.findall(text))
        specs.extend(REQUIRE_RE.findall(text))

        for spec in specs:
            spec = clean_specifier(spec)
            if not spec.startswith("."):
                continue
            resolved = resolve_relative(cur, spec)
            if not resolved:
                continue
            if resolved.suffix == ".css":
                reachable_css_direct.add(resolved)
            elif resolved.suffix in CODE_EXTS:
                queue.append(resolved)

    # --- Reachable CSS via @import closure ---
    reachable_css: set[Path] = set()
    css_queue: list[Path] = list(reachable_css_direct)
    while css_queue:
        css = css_queue.pop()
        if css in reachable_css:
            continue
        if not css.exists():
            continue
        reachable_css.add(css)

        css_text = get_css(css)
        for imp in CSS_IMPORT_RE.findall(css_text):
            resolved = resolve_css_import(css, imp)
            if resolved and resolved.suffix == ".css":
                css_queue.append(resolved)

    unreachable_css_files = [p for p in css_files if p not in reachable_css]

    # --- Used tokens from reachable code + index.html ---
    used_tokens: set[str] = set()
    used_data_attrs: set[str] = set()

    for f in reachable_code:
        t = get_code(f)
        used_tokens |= extract_used_tokens_from_code(t)
        used_data_attrs |= extract_data_attrs_from_code(t)

    if index_html.exists():
        html = read_text(index_html)
        used_tokens |= extract_used_tokens_from_code(html)
        used_data_attrs |= extract_data_attrs_from_code(html)

    # --- Dynamic class templates from reachable code ---
    dynamic_templates: list[DynamicTemplate] = []
    templates_by_file: dict[Path, list[DynamicTemplate]] = defaultdict(list)
    default_export_by_file: dict[Path, str | None] = {}

    for f in reachable_code:
        text = get_code(f)
        default_export_by_file[f] = find_default_export_name(text)
        templates = extract_dynamic_templates(text, f)
        if not templates:
            continue
        dynamic_templates.extend(templates)
        templates_by_file[f].extend(templates)

    # Index dynamic templates by component (default export) to avoid cross-component contamination
    # for common prop names like `size`.
    component_template_vars: dict[str, set[str]] = defaultdict(set)
    component_template_files: dict[str, Path] = {}

    for f, templates in templates_by_file.items():
        comp = default_export_by_file.get(f)
        if not comp:
            continue
        for t in templates:
            component_template_vars[comp].add(t.var)
            component_template_files.setdefault(comp, f)

    # Collect observed values for vars, scoped to the component tag name.
    component_observed_values: dict[tuple[str, str], set[str]] = defaultdict(set)

    # Defaults within component definition files (e.g., `size = 'md'`).
    for comp, comp_file in component_template_files.items():
        text = get_code(comp_file)
        for m in ASSIGN_STRING_RE.finditer(text):
            name = m.group(1)
            if name not in component_template_vars.get(comp, set()):
                continue
            val = m.group(2) or m.group(3)
            if val:
                component_observed_values[(comp, name)].add(val)
        for m in BRACED_ASSIGN_STRING_RE.finditer(text):
            name = m.group(1)
            if name not in component_template_vars.get(comp, set()):
                continue
            val = m.group(2) or m.group(3)
            if val:
                component_observed_values[(comp, name)].add(val)

    # JSX usages across the app: `<Component prop="value" ...>`
    for f in reachable_code:
        text = get_code(f)
        for comp, vars_ in component_template_vars.items():
            if f"<{comp}" not in text:
                continue
            for tag_text in iter_jsx_start_tags(text, comp):
                values = extract_top_level_string_props(tag_text, vars_)
                for var, vals in values.items():
                    component_observed_values[(comp, var)].update(vals)

    # Generate used tokens from dynamic templates when values are observed for the owning component.
    for t in dynamic_templates:
        comp = default_export_by_file.get(t.file)
        if not comp:
            continue
        for val in sorted(component_observed_values.get((comp, t.var), set())):
            if not SAFE_TOKEN_FRAGMENT_RE.match(val):
                continue
            used_tokens.add(f"{t.prefix}{val}{t.suffix}")

    dynamic_class_patterns: list[re.Pattern[str]] = [
        re.compile(rf"^{re.escape(t.prefix)}[A-Za-z0-9_-]+{re.escape(t.suffix)}$") for t in dynamic_templates
    ]

    def matches_dynamic_pattern(class_name: str) -> bool:
        return any(pat.match(class_name) for pat in dynamic_class_patterns)

    # --- Parse CSS rules (reachable CSS only) ---
    all_rules: list[CssRule] = []
    keyframes_to_files: dict[str, set[Path]] = defaultdict(set)
    custom_prop_to_files: dict[str, set[Path]] = defaultdict(set)

    for css in sorted(reachable_css):
        raw = get_css(css)
        rules, keyframes, custom_props = extract_css_rules_fast(css, raw)
        all_rules.extend(rules)
        for k in keyframes:
            keyframes_to_files[k].add(css)
        for p in custom_props:
            custom_prop_to_files[p].add(css)

    # var() uses across reachable CSS + reachable code
    var_uses: set[str] = set()
    for css in reachable_css:
        for m in VAR_USE_RE.finditer(get_css(css)):
            var_uses.add(m.group(1))
    for f in reachable_code:
        for m in VAR_USE_RE.finditer(get_code(f)):
            var_uses.add(m.group(1))

    combined_css_text = "\n".join(get_css(p) for p in reachable_css)
    combined_code_text = "\n".join(get_code(p) for p in reachable_code)

    # --- Classify selectors ---
    unused_high_conf: list[RuleNote] = []
    uncertain_dynamic: list[RuleNote] = []
    uncertain_data_attr: list[RuleNote] = []
    unknown_no_tokens: list[RuleNote] = []

    for rule in all_rules:
        selectors = split_selector_list(rule.selector_text)
        if not selectors:
            continue

        option_statuses: list[str] = []
        option_notes: list[RuleNote] = []

        for sel in selectors:
            classes = {c for c in extract_classes(sel) if not is_external_class(c)}
            ids = extract_ids(sel)
            data_attrs_sel = extract_data_attr_selectors(sel)

            if not classes and not ids and not data_attrs_sel:
                option_statuses.append("unknown")
                option_notes.append(
                    RuleNote(
                        file=rule.file,
                        line=rule.line,
                        selector_text=sel,
                        reason="unknown",
                        details="no class/id/data-* tokens",
                    )
                )
                continue

            missing_ids = {i for i in ids if i not in used_tokens}

            missing_classes_non_dynamic: set[str] = set()
            missing_classes_dynamic: set[str] = set()
            for c in classes:
                if c in used_tokens:
                    continue
                if matches_dynamic_pattern(c):
                    missing_classes_dynamic.add(c)
                    continue
                missing_classes_non_dynamic.add(c)

            missing_data_attrs = {a for a in data_attrs_sel if a not in used_data_attrs}

            if missing_ids or missing_classes_non_dynamic:
                option_statuses.append("impossible")
                option_notes.append(
                    RuleNote(
                        file=rule.file,
                        line=rule.line,
                        selector_text=sel,
                        reason="unused_high_confidence",
                        details=" ".join(
                            [
                                ("classes=" + ",".join(sorted(missing_classes_non_dynamic)))
                                if missing_classes_non_dynamic
                                else "",
                                ("ids=" + ",".join(sorted(missing_ids))) if missing_ids else "",
                            ]
                        ).strip(),
                    )
                )
                continue

            if missing_classes_dynamic:
                option_statuses.append("uncertain_dynamic")
                option_notes.append(
                    RuleNote(
                        file=rule.file,
                        line=rule.line,
                        selector_text=sel,
                        reason="uncertain_dynamic",
                        details="dynamic_classes=" + ",".join(sorted(missing_classes_dynamic)),
                    )
                )
                continue

            if missing_data_attrs:
                option_statuses.append("uncertain_data_attr")
                option_notes.append(
                    RuleNote(
                        file=rule.file,
                        line=rule.line,
                        selector_text=sel,
                        reason="uncertain_data_attr",
                        details="missing_data_attrs=" + ",".join(sorted(missing_data_attrs)),
                    )
                )
                continue

            option_statuses.append("used")
            option_notes.append(
                RuleNote(
                    file=rule.file,
                    line=rule.line,
                    selector_text=sel,
                    reason="used",
                    details="",
                )
            )

        if "used" in option_statuses:
            continue

        if "uncertain_dynamic" in option_statuses:
            # Show the original selector_text (possibly multi-selector rule) as a single note.
            details = "; ".join(n.details for n, st in zip(option_notes, option_statuses) if st == "uncertain_dynamic")
            uncertain_dynamic.append(
                RuleNote(
                    file=rule.file,
                    line=rule.line,
                    selector_text=rule.selector_text,
                    reason="uncertain_dynamic",
                    details=details,
                )
            )
            continue

        if "uncertain_data_attr" in option_statuses:
            details = "; ".join(n.details for n, st in zip(option_notes, option_statuses) if st == "uncertain_data_attr")
            uncertain_data_attr.append(
                RuleNote(
                    file=rule.file,
                    line=rule.line,
                    selector_text=rule.selector_text,
                    reason="uncertain_data_attr",
                    details=details,
                )
            )
            continue

        if "unknown" in option_statuses:
            unknown_no_tokens.append(
                RuleNote(
                    file=rule.file,
                    line=rule.line,
                    selector_text=rule.selector_text,
                    reason="unknown",
                    details="no class/id/data-* tokens",
                )
            )
            continue

        # All options impossible -> unused high confidence
        # Merge missing details from option_notes
        merged_details = "; ".join(n.details for n, st in zip(option_notes, option_statuses) if st == "impossible" and n.details)
        unused_high_conf.append(
            RuleNote(
                file=rule.file,
                line=rule.line,
                selector_text=rule.selector_text,
                reason="unused_high_confidence",
                details=merged_details or "missing=?",
            )
        )

    # --- Unused keyframes (rough) ---
    unused_keyframes: list[str] = []
    for name in sorted(keyframes_to_files.keys()):
        count = len(re.findall(r"\b" + re.escape(name) + r"\b", combined_css_text + combined_code_text))
        if count <= 1:
            unused_keyframes.append(name)

    # --- Unused CSS custom properties ---
    unused_custom_props = sorted([p for p in custom_prop_to_files.keys() if p not in var_uses])

    # --- Reporting ---
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines: list[str] = []
    lines.append("# CSS unused-style report")
    lines.append("")
    lines.append(f"- Generated: {now}")
    lines.append(f"- Scope: {frontend_dir.relative_to(repo_dir)}")
    lines.append("")
    lines.append("## Method (static)")
    lines.append("- Entry module: `src/main.tsx`")
    lines.append(
        "- Code reachability: follow relative `import`, `export ... from`, `import('...')`, `require('...')`"
    )
    lines.append("- CSS reachability: CSS imported by reachable modules + CSS `@import` closure")
    lines.append(
        "- **Used tokens** are discovered from string literals in reachable code + `index.html`, plus **observed expansions** of single-placeholder template literals like `` `btn--${size}` `` when `size=\"sm\"` / `size = 'md'`-style values are found."
    )
    lines.append(
        "- A selector is marked **unused (high confidence)** only when every selector option contains class/id tokens that are neither used nor plausibly generated by any detected dynamic template (excluding known external classes: `ProseMirror`, `tiptap`, `cm-*`)."
    )
    lines.append(
        "- Selectors depending on **dynamic templates** or `data-*` attributes are reported under **uncertain** sections for manual review."
    )
    lines.append("")

    lines.append("## Summary")
    lines.append(f"- Total CSS files under `src`: {len(css_files)}")
    lines.append(f"- Reachable CSS files: {len(reachable_css)}")
    lines.append(f"- Unreachable CSS files: {len(unreachable_css_files)}")
    lines.append(f"- Total CSS rules parsed (reachable CSS only): {len(all_rules)}")
    lines.append(f"- Unused selectors (high confidence): {len(unused_high_conf)}")
    lines.append(f"- Uncertain selectors (dynamic templates): {len(uncertain_dynamic)}")
    lines.append(f"- Uncertain selectors (`data-*`): {len(uncertain_data_attr)}")
    lines.append(f"- Unanalyzable selectors (no class/id/data-*): {len(unknown_no_tokens)}")
    lines.append(f"- `@keyframes` defined: {len(keyframes_to_files)} (unused: {len(unused_keyframes)})")
    lines.append(
        f"- Custom properties defined (`--*:`): {len(custom_prop_to_files)} (unused: {len(unused_custom_props)})"
    )
    lines.append("")

    lines.append("## Unreachable CSS files (not pulled into the app bundle)")
    if unreachable_css_files:
        for p in unreachable_css_files:
            lines.append(f"- `{p.relative_to(repo_dir)}`")
    else:
        lines.append("- (none)")
    lines.append("")

    def emit_grouped_rules(title: str, rules: list[RuleNote]) -> None:
        lines.append(title)
        lines.append("")
        lines.append("> Format: `path:line` selector  _(details)_")
        lines.append("")
        by_file: dict[Path, list[RuleNote]] = defaultdict(list)
        for r in rules:
            by_file[r.file].append(r)
        for f in sorted(by_file.keys(), key=lambda p: (-len(by_file[p]), str(p))):
            rel = f.relative_to(repo_dir)
            items = sorted(by_file[f], key=lambda r: (r.line, r.selector_text))
            lines.append(f"### `{rel}` ({len(items)})")
            for r in items:
                lines.append(f"- `{rel}:{r.line}` {norm_one_line(r.selector_text)}  _({r.details})_")
            lines.append("")

    emit_grouped_rules("## Unused selectors (high confidence)", unused_high_conf)
    emit_grouped_rules("## Uncertain selectors (dynamic templates)", uncertain_dynamic)
    emit_grouped_rules("## Uncertain selectors (`data-*` attributes)", uncertain_data_attr)

    lines.append("## Unanalyzable selectors (no class/id/data-*)")
    lines.append("> These may be used (element selectors, pseudo-selectors, etc.).")
    lines.append("")
    by_file_unknown: dict[Path, list[RuleNote]] = defaultdict(list)
    for r in unknown_no_tokens:
        by_file_unknown[r.file].append(r)
    for f in sorted(by_file_unknown.keys(), key=lambda p: (-len(by_file_unknown[p]), str(p))):
        rel = f.relative_to(repo_dir)
        items = sorted(by_file_unknown[f], key=lambda r: (r.line, r.selector_text))
        lines.append(f"### `{rel}` ({len(items)})")
        for r in items:
            lines.append(f"- `{rel}:{r.line}` {norm_one_line(r.selector_text)}")
        lines.append("")

    lines.append("## Unused `@keyframes` (rough)")
    if unused_keyframes:
        for name in unused_keyframes:
            files = sorted([p.relative_to(repo_dir) for p in keyframes_to_files.get(name, [])])
            files_str = ", ".join(f"`{p}`" for p in files) if files else "(unknown)"
            lines.append(f"- `{name}` defined in: {files_str}")
    else:
        lines.append("- (none)")
    lines.append("")

    lines.append("## Unused CSS custom properties (`--*`)")
    lines.append("> Marked unused when no `var(--name)` reference exists in reachable CSS or reachable code.")
    if unused_custom_props:
        for name in unused_custom_props:
            files = sorted([p.relative_to(repo_dir) for p in custom_prop_to_files.get(name, [])])
            files_str = ", ".join(f"`{p}`" for p in files) if files else "(unknown)"
            lines.append(f"- `{name}` defined in: {files_str}")
    else:
        lines.append("- (none)")
    lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote report to {output_path.relative_to(repo_dir)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

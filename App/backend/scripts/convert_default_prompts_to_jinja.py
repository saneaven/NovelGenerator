from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Sequence


ROOT = Path(__file__).resolve().parents[1]
TARGET_DIRS = [
    ROOT / "prompts" / "templates",
    ROOT / "prompts" / "default_fragments",
]


def _tokenize(expr: str) -> list[str]:
    tokens: list[str] = []
    i = 0
    n = len(expr)
    while i < n:
        ch = expr[i]
        if ch.isspace():
            i += 1
            continue
        if ch in "()":
            tokens.append(ch)
            i += 1
            continue
        if ch in {'"', "'"}:
            quote = ch
            j = i + 1
            escaped = False
            while j < n:
                c = expr[j]
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == quote:
                    break
                j += 1
            tokens.append(expr[i : min(j + 1, n)])
            i = j + 1
            continue

        j = i
        while j < n and (not expr[j].isspace()) and expr[j] not in "()":
            j += 1
        tokens.append(expr[i:j])
        i = j
    return tokens


def _normalize_token(token: str) -> str:
    t = token.strip()
    if not t:
        return t
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
        return t

    lower = t.lower()
    if lower == "true":
        return "true"
    if lower == "false":
        return "false"
    if lower in {"null", "undefined"}:
        return "none"

    t = t.replace("@root.", "")
    t = t.replace(".[", "[")
    return t


def _transform_call(fn: str, args: Sequence[str]) -> str:
    if fn == "eq" and len(args) >= 2:
        return f"({args[0]} == {args[1]})"
    if fn == "neq" and len(args) >= 2:
        return f"({args[0]} != {args[1]})"
    if fn == "and":
        return "(" + " and ".join(args) + ")"
    if fn == "or":
        return "(" + " or ".join(args) + ")"
    if fn == "not" and len(args) == 1:
        return f"(not {args[0]})"
    if fn == "includes" and len(args) >= 2:
        return f"({args[1]} in {args[0]})"
    if fn == "hasItems" and len(args) >= 1:
        return f"(({args[0]})|length > 0)"
    if fn == "count" and len(args) >= 1:
        return f"(({args[0]})|length)"
    if fn == "last" and len(args) >= 1:
        return f"(({args[0]})[-1])"
    if fn == "array":
        return "[" + ", ".join(args) + "]"
    if fn == "json" and len(args) >= 1:
        return f"({args[0]}|tojson)"

    if fn == "filterByType" and len(args) >= 2:
        return f"({args[0]}|filter_by_type({args[1]}))"
    if fn == "filterByIds" and len(args) >= 2:
        return f"({args[0]}|filter_by_ids({args[1]}))"
    if fn == "getById" and len(args) >= 2:
        return f"({args[0]}|get_by_id({args[1]}))"
    if fn == "getManuscript" and len(args) >= 2:
        return f"({args[0]}|get_manuscript({args[1]}))"

    if fn == "getObjectsOfLanguage":
        return f"get_objects_of_language({', '.join(args)})"
    if fn == "getManuscriptsOfLanguage":
        return f"get_manuscripts_of_language({', '.join(args)})"
    if fn == "lookup" and len(args) >= 2:
        return f"({args[0]}.get({args[1]}))"

    return f"{fn}({', '.join(args)})"


def _parse_tokens(tokens: list[str], pos: int = 0) -> tuple[str, int]:
    if pos >= len(tokens):
        return "", pos

    token = tokens[pos]
    if token != "(":
        return _normalize_token(token), pos + 1

    # s-expression: (fn arg1 arg2 ...)
    if pos + 1 >= len(tokens):
        return "", pos + 1
    fn = tokens[pos + 1]
    cursor = pos + 2
    args: list[str] = []
    while cursor < len(tokens) and tokens[cursor] != ")":
        arg, cursor = _parse_tokens(tokens, cursor)
        if arg:
            args.append(arg)
    if cursor < len(tokens) and tokens[cursor] == ")":
        cursor += 1
    return _transform_call(fn, args), cursor


def _split_args(raw: str) -> list[str]:
    args: list[str] = []
    current: list[str] = []
    depth = 0
    quote: str | None = None
    escaped = False

    for ch in raw:
        if quote:
            current.append(ch)
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == quote:
                quote = None
            continue

        if ch in {'"', "'"}:
            quote = ch
            current.append(ch)
            continue
        if ch == "(":
            depth += 1
            current.append(ch)
            continue
        if ch == ")":
            depth = max(depth - 1, 0)
            current.append(ch)
            continue
        if ch.isspace() and depth == 0:
            if current:
                args.append("".join(current).strip())
                current = []
            continue
        current.append(ch)

    if current:
        args.append("".join(current).strip())
    return [a for a in args if a]


def _convert_expression(expr: str) -> str:
    raw = expr.strip()
    if not raw:
        return raw

    raw = raw.replace("@root.", "").replace(".[", "[")

    tokens = _tokenize(raw)
    if not tokens:
        return raw

    # Handles plain helper calls without wrapping parentheses, e.g. "filterByIds a b"
    if tokens[0] != "(" and len(tokens) > 1:
        head = _normalize_token(tokens[0])
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", head):
            arg_values = [_convert_expression(tok) for tok in tokens[1:]]
            return _transform_call(head, arg_values)

    parsed, _ = _parse_tokens(tokens, 0)
    return parsed or raw


def _convert_file_content(content: str) -> str:
    out = content

    # Handlebars comments
    out = re.sub(
        r"\{\{!--(.*?)--\}\}",
        lambda m: "{# " + m.group(1).strip() + " #}",
        out,
        flags=re.DOTALL,
    )

    # Block helpers
    def repl_each(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        alias_match = re.match(r"(.+?)\s+as\s+\|([^\|]+)\|\s*$", inner)
        if alias_match:
            expr = _convert_expression(alias_match.group(1))
            alias = alias_match.group(2).strip()
        else:
            expr = _convert_expression(inner)
            alias = "this"
        return f"{{% for {alias} in {expr} %}}"

    def repl_with(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        alias_match = re.match(r"(.+?)\s+as\s+\|([^\|]+)\|\s*$", inner)
        if alias_match:
            expr = _convert_expression(alias_match.group(1))
            alias = alias_match.group(2).strip()
        else:
            expr = _convert_expression(inner)
            alias = "this"
        return f"{{% with {alias} = {expr} %}}"

    def repl_if(match: re.Match[str]) -> str:
        cond = _convert_expression(match.group(1))
        return f"{{% if {cond} %}}"

    out = re.sub(r"\{\{#each\s+(.+?)\}\}", repl_each, out)
    out = re.sub(r"\{\{#with\s+(.+?)\}\}", repl_with, out)
    out = re.sub(r"\{\{#if\s+(.+?)\}\}", repl_if, out)

    out = re.sub(r"\{\{\/each\s*\}\}", "{% endfor %}", out)
    out = re.sub(r"\{\{\/with\s*\}\}", "{% endwith %}", out)
    out = re.sub(r"\{\{else\s*\}\}", "{% else %}", out)
    out = re.sub(r"\{\{\/if\s*\}\}", "{% endif %}", out)

    # include helper with optional params.
    def repl_prompt(match: re.Match[str]) -> str:
        path = match.group(1).strip()
        args_raw = (match.group(2) or "").strip()
        if not args_raw:
            return '{% include "fragment:' + path + '" %}'
        args = [_convert_expression(arg) for arg in _split_args(args_raw)]
        return (
            "{% with params = ["
            + ", ".join(args)
            + '] %}{% include "fragment:'
            + path
            + '" %}{% endwith %}'
        )

    out = re.sub(r'\{\{\s*prompt\s+"([^"]+)"(.*?)\}\}', repl_prompt, out)

    # Remaining handlebars interpolations -> jinja interpolations.
    def repl_var(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        if not inner:
            return match.group(0)
        # Skip tags already converted into Jinja block syntax.
        if inner.startswith("%") or inner.startswith("{#"):
            return match.group(0)
        expr = _convert_expression(inner)
        return "{{ " + expr + " }}"

    out = re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", repl_var, out)
    return out


def _find_md_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted([p for p in root.rglob("*.md") if p.is_file()])


def _has_handlebars_remnants(text: str) -> bool:
    patterns = [
        r"\{\{#",
        r"\{\{/",
        r"\{\{!--",
        r"\{\{\s*prompt\s+\"",
    ]
    return any(re.search(p, text) for p in patterns)


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert default prompt files from Handlebars syntax to Jinja2.")
    parser.add_argument("--check", action="store_true", help="Do not write files, only report what would change.")
    args = parser.parse_args()

    changed: list[Path] = []
    unresolved: list[Path] = []

    for target in TARGET_DIRS:
        for path in _find_md_files(target):
            original = path.read_text(encoding="utf-8")
            converted = _convert_file_content(original)

            if converted != original:
                changed.append(path)
                if not args.check:
                    path.write_text(converted, encoding="utf-8")

            if _has_handlebars_remnants(converted):
                unresolved.append(path)

    print(f"converted_files={len(changed)}")
    for path in changed:
        print(f" - {path.relative_to(ROOT)}")

    print(f"unresolved_files={len(unresolved)}")
    for path in unresolved:
        print(f" ! {path.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


from __future__ import annotations

from functools import lru_cache
import re
from typing import Any, Dict, Iterable, List, Sequence

import mistune


_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+")
_SENTENCE_END_RE = re.compile(r"[\.!\?…]|[。！？]")


@lru_cache(maxsize=1)
def _md_ast() -> Any:
    return mistune.create_markdown(renderer="ast")


def _leading_heading_line(text: str) -> str | None:
    if not text:
        return None
    first_line = text.split("\n", 1)[0].strip()
    if _HEADING_RE.match(first_line):
        return first_line
    return None


def split_plaintext_blocks(text: str) -> List[str]:
    blocks: List[str] = []
    buf: List[str] = []
    for line in text.splitlines():
        if not line.strip():
            if buf:
                blocks.append("\n".join(buf).strip())
                buf = []
            continue
        buf.append(line.rstrip())
    if buf:
        blocks.append("\n".join(buf).strip())
    return [b for b in blocks if b]


def _token_type(tok: Any) -> str:
    return tok.get("type") if isinstance(tok, dict) else ""


def _token_children(tok: Any) -> List[Any]:
    if not isinstance(tok, dict):
        return []
    children = tok.get("children")
    return children if isinstance(children, list) else []


def _token_text(tok: Any) -> str:
    if tok is None:
        return ""
    if isinstance(tok, str):
        return tok
    if not isinstance(tok, dict):
        return ""

    t = _token_type(tok)
    if t in {"image"}:
        return ""
    if t in {"linebreak", "softbreak"}:
        return "\n"

    text = tok.get("text")
    if isinstance(text, str):
        return text
    raw = tok.get("raw")
    if isinstance(raw, str):
        return raw

    return "".join([_token_text(c) for c in _token_children(tok)])


def _render_list_text(tok: Dict[str, Any], *, indent: int = 0) -> str:
    attrs = tok.get("attrs") if isinstance(tok, dict) else None
    ordered = bool(attrs.get("ordered")) if isinstance(attrs, dict) else False
    start = attrs.get("start") if isinstance(attrs, dict) else None
    start_num = int(start) if isinstance(start, int) else 1

    lines: List[str] = []
    index = 0
    for child in _token_children(tok):
        if not isinstance(child, dict) or child.get("type") != "list_item":
            continue
        item_text = _render_list_item_text(child, indent=indent + 2).strip()
        if not item_text:
            continue
        bullet = f"{start_num + index}. " if ordered else "- "
        index += 1
        prefix = (" " * indent) + bullet
        parts = item_text.splitlines()
        if not parts:
            continue
        lines.append(prefix + parts[0])
        for extra in parts[1:]:
            lines.append((" " * len(prefix)) + extra)

    return "\n".join(lines).strip()


def _render_list_item_text(tok: Dict[str, Any], *, indent: int) -> str:
    parts: List[str] = []
    for child in _token_children(tok):
        child_type = _token_type(child)
        if child_type == "list":
            nested = _render_list_text(child, indent=indent)
            if nested:
                parts.append(nested)
            continue
        if child_type == "block_code":
            continue
        text = _token_text(child).strip()
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def split_markdown_blocks(text: str) -> List[str]:
    """Split markdown into blocks while preserving heading stack context.

    - Maintains heading stack (H1-H6) and groups following blocks under it.
    - Excludes code blocks and images.
    - Tables should already be stripped by the extractor (but can still appear as plain text).
    """
    text = (text or "").strip()
    if not text:
        return []

    tokens = _md_ast()(text)
    if not isinstance(tokens, list):
        return [text]

    heading_stack: List[str | None] = [None] * 6
    section_parts: List[str] = []
    out: List[str] = []

    def prefix_lines() -> List[str]:
        return [h for h in heading_stack if h]

    def flush() -> None:
        nonlocal section_parts
        content = "\n\n".join([p.strip() for p in section_parts if p and p.strip()]).strip()
        section_parts = []
        if not content:
            return
        prefix = prefix_lines()
        if prefix:
            out.append("\n".join(prefix + [content]).strip())
        else:
            out.append(content)

    def set_heading(level: int, heading_text: str) -> None:
        nonlocal heading_stack
        flush()
        if not isinstance(level, int):
            level = 1
        level = max(1, min(6, level))
        clean_text = heading_text.strip()
        if not clean_text:
            return
        heading_stack[level - 1] = f"{'#' * level} {clean_text}"
        for i in range(level, 6):
            heading_stack[i] = None

    def collect_blocks(tok: Any) -> List[str]:
        t = _token_type(tok)
        if t in {"block_code"}:
            return []
        if t == "paragraph":
            txt = _token_text(tok).strip()
            return [txt] if txt else []
        if t == "list":
            txt = _render_list_text(tok)
            return [txt] if txt else []
        if t == "block_quote":
            out_blocks: List[str] = []
            for child in _token_children(tok):
                out_blocks.extend(collect_blocks(child))
            return out_blocks

        txt = _token_text(tok).strip()
        return [txt] if txt else []

    for tok in tokens:
        t = _token_type(tok)
        if t == "heading":
            attrs = tok.get("attrs") if isinstance(tok, dict) else None
            level = 1
            if isinstance(attrs, dict) and isinstance(attrs.get("level"), int):
                level = attrs["level"]
            set_heading(level, _token_text(tok))
            continue
        if t == "thematic_break":
            flush()
            continue

        for part in collect_blocks(tok):
            if part:
                section_parts.append(part)

    flush()
    return [b for b in out if b and b.strip()]


def group_blocks_under_headings(blocks: List[str]) -> List[str]:
    """Attach a heading stack above a block for context.

    Legacy helper for callers that already split headings into standalone blocks.
    Prefer `split_markdown_blocks()` for new code.
    """
    out: List[str] = []
    stack: List[str | None] = [None] * 6

    for b in blocks:
        if _HEADING_RE.match(b):
            heading_line = b.strip()
            stripped = heading_line.lstrip()
            level = 0
            for ch in stripped:
                if ch == "#":
                    level += 1
                else:
                    break
            level = max(1, min(6, level or 1))
            stack[level - 1] = heading_line
            for i in range(level, 6):
                stack[i] = None
            continue

        prefix = [h for h in stack if h]
        if prefix:
            out.append("\n".join(prefix + [b]).strip())
        else:
            out.append(b)

    return out


def _join_blocks(blocks: Iterable[str]) -> str:
    out: List[str] = []
    prev_stack: List[str] = []

    for raw in blocks:
        b = (raw or "").strip()
        if not b:
            continue

        stack, body = _split_heading_stack(b)
        if stack:
            common = _common_prefix_len(prev_stack, stack)
            if stack == prev_stack:
                b = body
            elif common == len(prev_stack) and len(stack) > common:
                b = "\n".join(stack[common:] + ([body] if body else [])).strip()

        if not b:
            continue
        out.append(b)
        prev_stack = stack

    return "\n\n".join(out).strip()


def _split_heading_stack(text: str) -> tuple[List[str], str]:
    """Return (leading_heading_lines, body_without_those_headings)."""
    text = (text or "").strip()
    if not text:
        return ([], "")

    lines = text.split("\n")
    stack: List[str] = []
    i = 0

    # Allow leading blank lines, then consume consecutive heading lines.
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if _HEADING_RE.match(line):
            stack.append(line)
            i += 1
            continue
        break

    # Drop blank lines immediately after the heading stack.
    while i < len(lines) and not lines[i].strip():
        i += 1

    body = "\n".join(lines[i:]).strip()
    return (stack, body)


def _common_prefix_len(a: Sequence[str], b: Sequence[str]) -> int:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def _find_split_point(text: str, *, ideal: int, min_cut: int, max_cut: int) -> int:
    """Pick a split point <= max_cut using boundary priority.

    Priority: paragraph > sentence > whitespace > hard cut.
    """
    if max_cut <= min_cut:
        return max_cut

    search_end = min(max_cut, max(0, ideal))
    search_start = max(0, min_cut)

    # 1) paragraph boundary
    para_idx = text.rfind("\n\n", search_start, search_end)
    if para_idx != -1:
        return min(max_cut, para_idx + 2)

    # 2) sentence boundary (scan backwards)
    for i in range(search_end - 1, search_start - 1, -1):
        if _SENTENCE_END_RE.match(text[i]):
            # split after punctuation
            return min(max_cut, i + 1)

    # 3) whitespace boundary
    for i in range(search_end - 1, search_start - 1, -1):
        if text[i].isspace():
            return min(max_cut, i + 1)

    # 4) hard cut
    return max_cut


def _split_into_two_balanced(text: str, *, min_chars: int, max_chars: int) -> List[str]:
    total = len(text)
    if total <= max_chars:
        return [text.strip()]

    # Ensure both parts can be >= min_chars
    max_cut = min(max_chars, total - min_chars)
    min_cut = min_chars
    ideal = max(min_cut, min(max_cut, total // 2))
    cut = _find_split_point(text, ideal=ideal, min_cut=min_cut, max_cut=max_cut)
    a = text[:cut].strip()
    b = text[cut:].strip()
    if not a or not b:
        # Fallback hard cut
        a = text[:max_chars].strip()
        b = text[max_chars:].strip()
    return [a, b]


def split_text_to_max(text: str, *, min_chars: int, target_chars: int, max_chars: int) -> List[str]:
    """Split a single long text into <= max_chars parts with tail-avoidance."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    # If the chunk starts with a heading stack, keep the full stack on every split chunk.
    stack, body = _split_heading_stack(text)
    if stack and body:
        prefix = "\n".join(stack).strip()
        overhead = len(prefix) + 1
        if overhead < max_chars:
            max_body = max(1, max_chars - overhead)
            min_body = max(1, min_chars - overhead)
            target_body = max(1, target_chars - overhead)
            parts = split_text_to_max(body, min_chars=min_body, target_chars=target_body, max_chars=max_body)
            return [f"{prefix}\n{p}".strip() for p in parts if p and p.strip()]

    parts: List[str] = []
    remaining = text

    while len(remaining) > max_chars:
        # If a max-cut would leave a tiny tail, rebalance.
        if len(remaining) <= max_chars + min_chars:
            parts.extend(_split_into_two_balanced(remaining, min_chars=min_chars, max_chars=max_chars))
            return [p for p in parts if p]

        max_cut = max_chars
        min_cut = min_chars

        # If we are close to the end, avoid leaving a tail < min_chars.
        if len(remaining) - max_cut < min_chars:
            # Pull the cut earlier so the remainder is >= min_chars.
            max_cut = max(min_cut, len(remaining) - min_chars)

        cut = _find_split_point(remaining, ideal=max_cut, min_cut=min_cut, max_cut=max_cut)
        head = remaining[:cut].strip()
        remaining = remaining[cut:].strip()
        if head:
            parts.append(head)
        else:
            # hard fallback to avoid infinite loop
            parts.append(remaining[:max_chars].strip())
            remaining = remaining[max_chars:].strip()

    if remaining:
        if parts and len(remaining) < min_chars:
            combined = f"{parts.pop()}\n{remaining}".strip()
            parts.extend(_split_into_two_balanced(combined, min_chars=min_chars, max_chars=max_chars))
        else:
            parts.append(remaining.strip())

    return [p for p in parts if p]


def merge_blocks_by_length(
    blocks: List[str],
    *,
    min_chars: int,
    target_chars: int,
    max_chars: int,
) -> List[str]:
    """Merge blocks into chunks aiming for target_chars, respecting max_chars.

    Strategy:
    - Accumulate blocks until adding next would exceed max_chars.
    - If current chunk is too small (< min_chars), allow overflow and split later.
    - Any overflow chunk is split with boundary-priority + tail-avoidance.
    """
    chunks: List[str] = []
    buf: List[str] = []
    buf_len = 0

    def flush() -> None:
        nonlocal buf, buf_len
        if not buf:
            return
        joined = _join_blocks(buf)
        buf = []
        buf_len = 0
        if not joined:
            return
        # Split if needed
        chunks.extend(split_text_to_max(joined, min_chars=min_chars, target_chars=target_chars, max_chars=max_chars))

    for b in blocks:
        b = b.strip()
        if not b:
            continue
        add_len = len(b) + (2 if buf else 0)

        if buf_len + add_len <= max_chars:
            buf.append(b)
            buf_len += add_len
            continue

        # Would exceed max_chars
        if buf_len < min_chars:
            # Keep merging to avoid tiny chunks; we'll split later.
            buf.append(b)
            buf_len += add_len
            continue

        flush()
        buf.append(b)
        buf_len = len(b)

    flush()

    # Optional light rebalancing: if we have a tiny last chunk, merge and re-split.
    if len(chunks) >= 2 and len(chunks[-1]) < min_chars:
        tail = chunks.pop()
        merged = f"{chunks.pop()}\n{tail}".strip()
        chunks.extend(split_text_to_max(merged, min_chars=min_chars, target_chars=target_chars, max_chars=max_chars))

    return [c for c in chunks if c]

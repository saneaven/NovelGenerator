from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


_MARKDOWN_PARAGRAPH_SEPARATOR_RE = re.compile(r"\n\s*\n+")


@dataclass(frozen=True)
class MarkdownParagraphOffset:
    start: int
    end: int


def parse_markdown_paragraph_offset(value: Any) -> MarkdownParagraphOffset | None:
    if value is None:
        return None
    if not isinstance(value, dict) or isinstance(value, list):
        raise ValueError("offset must be an object")

    start = value.get("from")
    end = value.get("to")
    if not isinstance(start, int) or isinstance(start, bool):
        raise ValueError("offset.from must be an integer")
    if not isinstance(end, int) or isinstance(end, bool):
        raise ValueError("offset.to must be an integer")
    if start < 0:
        raise ValueError("offset.from must be >= 0")
    if end <= start:
        raise ValueError("offset.to must be greater than offset.from")

    return MarkdownParagraphOffset(start=start, end=end)


def split_markdown_paragraphs(markdown: str) -> list[str]:
    normalized = str(markdown or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []
    return [chunk.strip() for chunk in _MARKDOWN_PARAGRAPH_SEPARATOR_RE.split(normalized) if chunk.strip()]


def slice_markdown_by_paragraph_offset(markdown: str, offset: Any) -> str:
    parsed = parse_markdown_paragraph_offset(offset)
    if parsed is None:
        return markdown

    paragraphs = split_markdown_paragraphs(markdown)
    end = min(parsed.end, len(paragraphs))
    return "\n\n".join(paragraphs[parsed.start:end])

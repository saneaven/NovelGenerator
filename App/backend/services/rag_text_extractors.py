from __future__ import annotations

import re
from typing import Any, Dict

from .basic_info_utils import join_string_list


_FENCED_CODE_BLOCK_RE = re.compile(r"```.*?```", flags=re.DOTALL)
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^\)]*\)")
_HTML_IMG_RE = re.compile(r"<img[^>]*>", flags=re.IGNORECASE)

_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$")


def safe_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def strip_markdown_code_blocks(text: str) -> str:
    return _FENCED_CODE_BLOCK_RE.sub("", text)


def strip_markdown_images(text: str) -> str:
    text = _MD_IMAGE_RE.sub("", text)
    text = _HTML_IMG_RE.sub("", text)
    return text


def strip_markdown_tables(text: str) -> str:
    """Remove markdown tables (pipe tables).

    Conservative heuristic: detect a header row followed by a separator line, then
    skip consecutive pipe rows until a blank line.
    """
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        next_line = lines[i + 1] if i + 1 < len(lines) else ""

        is_table_header = ("|" in line) and (_TABLE_SEPARATOR_RE.match(next_line.strip()) is not None)
        if is_table_header:
            # Skip header + separator
            i += 2
            # Skip body rows
            while i < len(lines):
                if not lines[i].strip():
                    break
                if "|" not in lines[i]:
                    break
                i += 1
            continue

        out.append(line)
        i += 1

    return "\n".join(out)


def strip_markdown_assets(text: str) -> str:
    text = strip_markdown_code_blocks(text)
    text = strip_markdown_images(text)
    text = strip_markdown_tables(text)
    return text


_TIPTAP_SKIP_TYPES = {
    "image",
    "table",
    "tableRow",
    "tableCell",
    "codeBlock",
}

_TIPTAP_BLOCK_TYPES = {
    "paragraph",
    "heading",
    "listItem",
}


def _tiptap_collect_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    node_type = node.get("type")
    if node_type in _TIPTAP_SKIP_TYPES:
        return ""
    if node_type == "text":
        return safe_str(node.get("text"))
    parts: list[str] = []
    for child in node.get("content") or []:
        parts.append(_tiptap_collect_text(child))
    return "".join(parts)


def extract_tiptap_text(doc: Dict[str, Any]) -> str:
    """Extract plain text blocks from TipTap JSON.

    Only indexes a subset of node types (paragraph/heading/listItem) and skips
    image/table/codeBlock nodes entirely.
    """
    blocks: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        node_type = node.get("type")
        if node_type in _TIPTAP_SKIP_TYPES:
            return
        if node_type in _TIPTAP_BLOCK_TYPES:
            text = _tiptap_collect_text(node).strip()
            if text:
                blocks.append(text)
            return
        for child in node.get("content") or []:
            walk(child)

    walk(doc)
    return "\n\n".join(blocks).strip()


def extract_index_text(object_type: str, version_data: Dict[str, Any], language: str) -> Dict[str, str]:
    """Return indexable text fields for a unified object in the given language.

    Index policy:
    - Only indexes `language` (main_language) content.
    - Excludes images/tables/code blocks.
    """
    lang_blob = version_data.get(language)
    if not isinstance(lang_blob, dict):
        return {}

    if object_type == "manuscript":
        doc = lang_blob.get("doc")
        if not isinstance(doc, dict):
            return {}
        return {"doc": extract_tiptap_text(doc)}

    if object_type == "guidelines":
        author_note = strip_markdown_assets(safe_str(lang_blob.get("authorNote", ""))).strip()
        return {"content": author_note} if author_note else {}

    if object_type == "basic_info":
        title = safe_str(lang_blob.get("title", "")).strip()
        logline = safe_str(lang_blob.get("logline", "")).strip()
        genres = join_string_list(lang_blob.get("genres"))
        tags = join_string_list(lang_blob.get("tags"))
        content = "\n".join([f"Title: {title}", f"Logline: {logline}", f"Genres: {genres}", f"Tags: {tags}"]).strip()
        return {"content": content} if content else {}

    name = strip_markdown_assets(safe_str(lang_blob.get("name", "")))
    description = strip_markdown_assets(safe_str(lang_blob.get("description", "")))
    content = strip_markdown_assets(safe_str(lang_blob.get("content", "")))

    return {
        "name": name.strip(),
        "description": description.strip(),
        "content": content.strip(),
    }

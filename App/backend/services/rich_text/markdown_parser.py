from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from markdown_it_pyrs import MarkdownIt

from .normalize import normalize_tree
from .types import ContentNode, ContentTreeDoc


_MARKDOWN = MarkdownIt("commonmark").enable_many(["table", "strikethrough", "autolink_ext", "tasklist"])


def _text_meta(node: Any) -> str:
    return str(getattr(node, "meta", {}).get("content") or "")


def _extract_asset_id_from_src(src: str) -> str | None:
    parsed = urlparse(str(src or ""))
    path = parsed.path or str(src or "")
    if not path.startswith("/storage/assets/originals/"):
        return None
    stem = Path(path).stem
    try:
        return str(UUID(stem))
    except Exception:
        return None


def _append_mark(active_marks: list[dict[str, Any]], mark: dict[str, Any]) -> list[dict[str, Any]]:
    return [*active_marks, mark]


def _text_node(text: str, marks: list[dict[str, Any]]) -> ContentNode | None:
    if not text:
        return None
    node: ContentNode = {"type": "text", "text": text}
    if marks:
        node["marks"] = marks
    return node


def _convert_inline(node: Any, active_marks: list[dict[str, Any]] | None = None) -> list[ContentNode]:
    marks = list(active_marks or [])
    name = str(getattr(node, "name", "") or "")

    if name == "text":
        text_node = _text_node(_text_meta(node), marks)
        return [text_node] if text_node is not None else []
    if name == "text_special":
        text_node = _text_node(_text_meta(node), marks)
        return [text_node] if text_node is not None else []
    if name == "softbreak":
        text_node = _text_node(" ", marks)
        return [text_node] if text_node is not None else []
    if name == "hardbreak":
        return [{"type": "hard_break"}]
    if name == "code_inline":
        text_node = _text_node(_text_meta(node), _append_mark(marks, {"type": "code"}))
        return [text_node] if text_node is not None else []
    if name == "strong":
        out: list[ContentNode] = []
        for child in getattr(node, "children", []) or []:
            out.extend(_convert_inline(child, _append_mark(marks, {"type": "bold"})))
        return out
    if name == "em":
        out = []
        for child in getattr(node, "children", []) or []:
            out.extend(_convert_inline(child, _append_mark(marks, {"type": "italic"})))
        return out
    if name == "strikethrough":
        out = []
        for child in getattr(node, "children", []) or []:
            out.extend(_convert_inline(child, _append_mark(marks, {"type": "strike"})))
        return out
    if name == "link":
        href = str(getattr(node, "meta", {}).get("url") or "").strip()
        if not href:
            return []
        out = []
        link_mark = {"type": "link", "attrs": {"href": href}}
        for child in getattr(node, "children", []) or []:
            out.extend(_convert_inline(child, _append_mark(marks, link_mark)))
        return out
    if name == "autolink":
        href = str(getattr(node, "meta", {}).get("url") or "").strip()
        if not href:
            return []
        out = []
        link_mark = {"type": "link", "attrs": {"href": href}}
        for child in getattr(node, "children", []) or []:
            out.extend(_convert_inline(child, _append_mark(marks, link_mark)))
        return out
    if name == "image":
        src = str(getattr(node, "meta", {}).get("url") or "").strip()
        if not src:
            return []
        alt_parts = []
        for child in getattr(node, "children", []) or []:
            alt_parts.append(_text_meta(child))
        attrs: dict[str, Any] = {"src": src}
        alt = "".join(alt_parts).strip()
        if alt:
            attrs["alt"] = alt
        asset_id = _extract_asset_id_from_src(src)
        if asset_id:
            attrs["assetId"] = asset_id
        return [{"type": "image", "attrs": attrs}]
    if name in {"html_inline", "html_block"}:
        text_node = _text_node(_text_meta(node), marks)
        return [text_node] if text_node is not None else []

    out = []
    for child in getattr(node, "children", []) or []:
        out.extend(_convert_inline(child, marks))
    return out


def _inline_paragraph(children: list[Any]) -> ContentNode:
    return {"type": "paragraph", "content": [part for child in children for part in _convert_inline(child)]}


def _convert_list_item(node: Any, *, task: bool) -> ContentNode:
    attrs: dict[str, Any] = {}
    children = list(getattr(node, "children", []) or [])
    if task and children and str(getattr(children[0], "name", "")) == "todo_checkbox":
        attrs["checked"] = bool(getattr(children[0], "meta", {}).get("checked"))
        children = children[1:]
    content: list[ContentNode] = []
    inline_buffer: list[Any] = []

    def flush_inline() -> None:
        nonlocal inline_buffer
        if not inline_buffer:
            return
        content.append(_inline_paragraph(inline_buffer))
        inline_buffer = []

    for child in children:
        child_name = str(getattr(child, "name", "") or "")
        if child_name in {"text", "text_special", "em", "strong", "strikethrough", "code_inline", "link", "autolink", "softbreak", "hardbreak", "image"}:
            inline_buffer.append(child)
            continue
        if child_name in {"paragraph", "bullet_list", "ordered_list", "blockquote", "task_list", "table", "fence", "code_block", "horizontal_rule", "hr"}:
            flush_inline()
            content.extend(_convert_block(child))
            continue
        if child_name == "todo_checkbox":
            continue
        flush_inline()
        content.extend(_convert_block(child))
    flush_inline()
    node_type = "task_item" if task else "list_item"
    out: ContentNode = {"type": node_type, "content": content}
    if attrs:
        out["attrs"] = attrs
    return out


def _convert_table(node: Any) -> ContentNode:
    rows: list[ContentNode] = []
    for section in getattr(node, "children", []) or []:
        section_name = str(getattr(section, "name", "") or "")
        if section_name not in {"thead", "tbody"}:
            continue
        cell_type = "table_header" if section_name == "thead" else "table_cell"
        for row in getattr(section, "children", []) or []:
            if str(getattr(row, "name", "") or "") != "trow":
                continue
            row_cells: list[ContentNode] = []
            for cell in getattr(row, "children", []) or []:
                if str(getattr(cell, "name", "") or "") != "tcell":
                    continue
                row_cells.append(
                    {
                        "type": cell_type,
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [part for child in getattr(cell, "children", []) or [] for part in _convert_inline(child)],
                            }
                        ],
                    }
                )
            rows.append({"type": "table_row", "content": row_cells})
    return {"type": "table", "content": rows}


def _convert_block(node: Any) -> list[ContentNode]:
    name = str(getattr(node, "name", "") or "")
    if name == "paragraph":
        return [{"type": "paragraph", "content": [part for child in getattr(node, "children", []) or [] for part in _convert_inline(child)]}]
    if name == "heading":
        return [{
            "type": "heading",
            "attrs": {"level": int(getattr(node, "meta", {}).get("level") or 1)},
            "content": [part for child in getattr(node, "children", []) or [] for part in _convert_inline(child)],
        }]
    if name == "blockquote":
        content: list[ContentNode] = []
        for child in getattr(node, "children", []) or []:
            content.extend(_convert_block(child))
        return [{"type": "blockquote", "content": content}]
    if name == "bullet_list":
        children = list(getattr(node, "children", []) or [])
        is_task = bool(children) and all(
            str(getattr(child, "name", "") or "") == "list_item"
            and any(str(getattr(grandchild, "name", "") or "") == "todo_checkbox" for grandchild in getattr(child, "children", []) or [])
            for child in children
        )
        list_type = "task_list" if is_task else "bullet_list"
        return [{"type": list_type, "content": [_convert_list_item(child, task=is_task) for child in children]}]
    if name == "ordered_list":
        return [{
            "type": "ordered_list",
            "attrs": {"start": int(getattr(node, "meta", {}).get("start") or 1)},
            "content": [_convert_list_item(child, task=False) for child in getattr(node, "children", []) or []],
        }]
    if name in {"fence", "code_block"}:
        text = str(getattr(node, "meta", {}).get("content") or "")
        attrs: dict[str, Any] = {}
        language = str(getattr(node, "meta", {}).get("info") or "").strip()
        if language:
            attrs["language"] = language.split()[0]
        out: ContentNode = {"type": "code_block", "content": [{"type": "text", "text": text.rstrip("\n")}]}
        if attrs:
            out["attrs"] = attrs
        return [out]
    if name == "hr":
        return [{"type": "horizontal_rule"}]
    if name == "table":
        return [_convert_table(node)]
    if name in {"html_block", "html_inline"}:
        return [{"type": "paragraph", "content": [{"type": "text", "text": _text_meta(node)}]}]
    if name in {"text", "text_special", "softbreak", "hardbreak", "em", "strong", "strikethrough", "code_inline", "link", "autolink", "image"}:
        return [{"type": "paragraph", "content": _convert_inline(node)}]
    content: list[ContentNode] = []
    for child in getattr(node, "children", []) or []:
        content.extend(_convert_block(child))
    return content


def markdown_to_tree(markdown: str) -> ContentTreeDoc:
    root = _MARKDOWN.tree(str(markdown or ""))
    doc: ContentTreeDoc = {"type": "doc", "content": []}
    for child in getattr(root, "children", []) or []:
        doc["content"].extend(_convert_block(child))
    return normalize_tree(doc)

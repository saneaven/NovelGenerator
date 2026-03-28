from __future__ import annotations

from copy import deepcopy
from typing import Any

from .types import ContentNode, ContentTreeDoc


_ALLOWED_NODE_ATTRS: dict[str, set[str]] = {
    "heading": {"level"},
    "ordered_list": {"start"},
    "task_item": {"checked"},
    "code_block": {"language"},
    "image": {"src", "alt", "title", "assetId"},
}


def empty_doc() -> ContentTreeDoc:
    return {"type": "doc", "content": []}


def _normalize_marks(marks: Any) -> list[dict[str, Any]]:
    if not isinstance(marks, list):
        return []

    out: list[dict[str, Any]] = []
    for mark in marks:
        if not isinstance(mark, dict):
            continue
        mark_type = str(mark.get("type") or "").strip()
        if mark_type not in {"bold", "italic", "strike", "code", "link"}:
            continue
        if mark_type == "link":
            href = str((mark.get("attrs") or {}).get("href") or "").strip()
            if not href:
                continue
            out.append({"type": "link", "attrs": {"href": href}})
            continue
        out.append({"type": mark_type})
    return out


def _normalize_attrs(node_type: str, attrs: Any) -> dict[str, Any]:
    if not isinstance(attrs, dict):
        attrs = {}
    allowed = _ALLOWED_NODE_ATTRS.get(node_type)
    if not allowed:
        return {}
    out: dict[str, Any] = {}
    for key in allowed:
        if key not in attrs:
            continue
        value = attrs.get(key)
        if key == "level":
            try:
                level = int(value)
            except Exception:
                level = 1
            out["level"] = min(max(level, 1), 6)
        elif key == "start":
            try:
                start = int(value)
            except Exception:
                start = 1
            out["start"] = max(start, 1)
        elif key == "checked":
            out["checked"] = bool(value)
        elif key == "language":
            language = str(value or "").strip()
            if language:
                out["language"] = language
        elif key == "src":
            src = str(value or "").strip()
            if src:
                out["src"] = src
        elif key == "alt":
            alt = str(value or "")
            if alt:
                out["alt"] = alt
        elif key == "title":
            title = str(value or "")
            if title:
                out["title"] = title
        elif key == "assetId":
            asset_id = str(value or "").strip()
            if asset_id:
                out["assetId"] = asset_id
    if node_type == "ordered_list" and "start" not in out:
        out["start"] = 1
    if node_type == "task_item" and "checked" not in out:
        out["checked"] = False
    return out


def _merge_adjacent_text_nodes(content: list[ContentNode]) -> list[ContentNode]:
    merged: list[ContentNode] = []
    for node in content:
        if not merged:
            merged.append(node)
            continue
        prev = merged[-1]
        if (
            prev.get("type") == "text"
            and node.get("type") == "text"
            and prev.get("marks") == node.get("marks")
        ):
            prev["text"] = f"{prev.get('text', '')}{node.get('text', '')}"
            continue
        merged.append(node)
    return merged


def _normalize_node(node: Any) -> ContentNode | None:
    if not isinstance(node, dict):
        return None

    node_type = str(node.get("type") or "").strip()
    if not node_type:
        return None

    if node_type == "text":
        text = str(node.get("text") or "")
        if not text:
            return None
        normalized: ContentNode = {"type": "text", "text": text}
        marks = _normalize_marks(node.get("marks"))
        if marks:
            normalized["marks"] = marks
        return normalized

    normalized: ContentNode = {"type": node_type}
    attrs = _normalize_attrs(node_type, node.get("attrs"))
    if attrs:
        normalized["attrs"] = attrs

    content = node.get("content")
    if isinstance(content, list):
        normalized_content = []
        for child in content:
            normalized_child = _normalize_node(child)
            if normalized_child is not None:
                normalized_content.append(normalized_child)
        normalized_content = _merge_adjacent_text_nodes(normalized_content)
        if normalized_content:
            normalized["content"] = normalized_content
        elif node_type == "doc":
            normalized["content"] = []

    if node_type == "image" and "src" not in (normalized.get("attrs") or {}):
        return None

    if node_type == "heading" and "attrs" not in normalized:
        normalized["attrs"] = {"level": 1}
    if node_type == "ordered_list" and "attrs" not in normalized:
        normalized["attrs"] = {"start": 1}
    if node_type == "task_item" and "attrs" not in normalized:
        normalized["attrs"] = {"checked": False}

    return normalized


def normalize_tree(tree: Any) -> ContentTreeDoc:
    normalized = _normalize_node(deepcopy(tree))
    if normalized is None or normalized.get("type") != "doc":
        return empty_doc()
    normalized.setdefault("content", [])
    return normalized

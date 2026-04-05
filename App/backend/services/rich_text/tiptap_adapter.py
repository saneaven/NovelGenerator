from __future__ import annotations

from typing import Any

from .normalize import empty_doc, normalize_tree
from .types import ContentNode, ContentTreeDoc


_TIPTAP_TO_TREE_NODE = {
    "doc": "doc",
    "paragraph": "paragraph",
    "heading": "heading",
    "blockquote": "blockquote",
    "bulletList": "bullet_list",
    "orderedList": "ordered_list",
    "taskList": "task_list",
    "listItem": "list_item",
    "taskItem": "task_item",
    "codeBlock": "code_block",
    "hardBreak": "hard_break",
    "horizontalRule": "horizontal_rule",
    "image": "image",
    "table": "table",
    "tableRow": "table_row",
    "tableHeader": "table_header",
    "tableCell": "table_cell",
    "text": "text",
}

_TREE_TO_TIPTAP_NODE = {value: key for key, value in _TIPTAP_TO_TREE_NODE.items()}


def _tiptap_marks_to_tree(marks: Any) -> list[dict[str, Any]]:
    if not isinstance(marks, list):
        return []
    out: list[dict[str, Any]] = []
    for mark in marks:
        if not isinstance(mark, dict):
            continue
        mark_type = str(mark.get("type") or "").strip()
        if mark_type in {"bold", "italic", "strike", "code"}:
            out.append({"type": mark_type})
            continue
        if mark_type == "link":
            href = str((mark.get("attrs") or {}).get("href") or "").strip()
            if href:
                out.append({"type": "link", "attrs": {"href": href}})
    return out


def _tree_marks_to_tiptap(marks: Any) -> list[dict[str, Any]]:
    if not isinstance(marks, list):
        return []
    out: list[dict[str, Any]] = []
    for mark in marks:
        if not isinstance(mark, dict):
            continue
        mark_type = str(mark.get("type") or "").strip()
        if mark_type in {"bold", "italic", "strike", "code"}:
            out.append({"type": mark_type})
            continue
        if mark_type == "link":
            href = str((mark.get("attrs") or {}).get("href") or "").strip()
            if href:
                out.append({"type": "link", "attrs": {"href": href}})
    return out


def _tiptap_to_tree_node(node: Any) -> ContentNode | None:
    if not isinstance(node, dict):
        return None
    tiptap_type = str(node.get("type") or "").strip()
    tree_type = _TIPTAP_TO_TREE_NODE.get(tiptap_type)
    if not tree_type:
        return None

    if tree_type == "text":
        text = str(node.get("text") or "")
        if not text:
            return None
        out: ContentNode = {"type": "text", "text": text}
        marks = _tiptap_marks_to_tree(node.get("marks"))
        if marks:
            out["marks"] = marks
        return out

    out: ContentNode = {"type": tree_type}
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    tree_attrs: dict[str, Any] = {}
    if tree_type == "heading":
        tree_attrs["level"] = attrs.get("level")
    elif tree_type == "ordered_list":
        tree_attrs["start"] = attrs.get("start")
    elif tree_type == "task_item":
        tree_attrs["checked"] = attrs.get("checked")
    elif tree_type == "code_block":
        tree_attrs["language"] = attrs.get("language")
    elif tree_type == "image":
        tree_attrs["src"] = attrs.get("src")
        if "alt" in attrs:
            tree_attrs["alt"] = attrs.get("alt")
        if "data-asset-id" in attrs:
            tree_attrs["assetId"] = attrs.get("data-asset-id")
    if tree_attrs:
        out["attrs"] = tree_attrs

    children = node.get("content")
    if isinstance(children, list):
        converted_children = []
        for child in children:
            converted = _tiptap_to_tree_node(child)
            if converted is not None:
                converted_children.append(converted)
        out["content"] = converted_children
    return out


def tiptap_to_tree(doc: Any) -> ContentTreeDoc:
    tree = _tiptap_to_tree_node(doc)
    if tree is None:
        return empty_doc()
    return normalize_tree(tree)


def _tree_to_tiptap_node(node: Any) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None
    tree_type = str(node.get("type") or "").strip()
    tiptap_type = _TREE_TO_TIPTAP_NODE.get(tree_type)
    if not tiptap_type:
        return None
    if tree_type == "text":
        out: dict[str, Any] = {"type": "text", "text": str(node.get("text") or "")}
        marks = _tree_marks_to_tiptap(node.get("marks"))
        if marks:
            out["marks"] = marks
        return out
    out = {"type": tiptap_type}
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    tiptap_attrs: dict[str, Any] = {}
    if tree_type == "heading":
        tiptap_attrs["level"] = attrs.get("level")
    elif tree_type == "ordered_list":
        tiptap_attrs["start"] = attrs.get("start")
    elif tree_type == "task_item":
        tiptap_attrs["checked"] = attrs.get("checked")
    elif tree_type == "code_block":
        if attrs.get("language"):
            tiptap_attrs["language"] = attrs.get("language")
    elif tree_type == "image":
        tiptap_attrs["src"] = attrs.get("src")
        if attrs.get("alt"):
            tiptap_attrs["alt"] = attrs.get("alt")
        if attrs.get("assetId"):
            tiptap_attrs["data-asset-id"] = attrs.get("assetId")
    if tiptap_attrs:
        out["attrs"] = tiptap_attrs
    children = node.get("content")
    if isinstance(children, list):
        converted_children = []
        for child in children:
            converted = _tree_to_tiptap_node(child)
            if converted is not None:
                converted_children.append(converted)
        if converted_children:
            out["content"] = converted_children
    return out


def tree_to_tiptap(doc: Any) -> dict[str, Any]:
    normalized = normalize_tree(doc)
    converted = _tree_to_tiptap_node(normalized)
    return converted or {"type": "doc", "content": []}

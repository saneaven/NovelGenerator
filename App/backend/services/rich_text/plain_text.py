from __future__ import annotations

import re
from typing import Any

from .normalize import normalize_tree


_WORD_RE = re.compile(r"\w+", flags=re.UNICODE)


def _collect_inline_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    node_type = str(node.get("type") or "")
    if node_type == "text":
        return str(node.get("text") or "")
    if node_type in {"image", "hard_break", "horizontal_rule"}:
        return ""
    parts: list[str] = []
    for child in node.get("content") or []:
        part = _collect_inline_text(child)
        if part:
            parts.append(part)
    return "".join(parts)


def tree_to_text(tree: Any) -> str:
    doc = normalize_tree(tree)
    blocks: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        node_type = str(node.get("type") or "")
        if node_type in {
            "paragraph",
            "heading",
            "blockquote",
            "list_item",
            "task_item",
            "table_header",
            "table_cell",
        }:
            text = _collect_inline_text(node).strip()
            if text:
                blocks.append(text)
            for child in node.get("content") or []:
                child_type = str((child or {}).get("type") or "")
                if child_type in {"bullet_list", "ordered_list", "task_list", "table"}:
                    walk(child)
            return
        if node_type in {"code_block", "image", "horizontal_rule"}:
            return
        for child in node.get("content") or []:
            walk(child)

    walk(doc)
    return "\n\n".join(part for part in blocks if part).strip()


def word_count(tree: Any) -> int:
    return len(_WORD_RE.findall(tree_to_text(tree)))

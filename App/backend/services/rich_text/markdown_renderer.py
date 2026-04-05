from __future__ import annotations

from typing import Any

from .normalize import normalize_tree


def _escape_text(text: str) -> str:
    return str(text or "")



def _render_inline(nodes: list[Any] | None) -> str:
    parts: list[str] = []
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("type") or "")
        if node_type == "text":
            text = _escape_text(str(node.get("text") or ""))
            for mark in node.get("marks") or []:
                if not isinstance(mark, dict):
                    continue
                mark_type = str(mark.get("type") or "")
                if mark_type == "bold":
                    text = f"**{text}**"
                elif mark_type == "italic":
                    text = f"*{text}*"
                elif mark_type == "strike":
                    text = f"~~{text}~~"
                elif mark_type == "code":
                    text = f"`{text}`"
                elif mark_type == "link":
                    href = str((mark.get("attrs") or {}).get("href") or "").strip()
                    if href:
                        text = f"[{text}]({href})"
            parts.append(text)
        elif node_type == "image":
            attrs = node.get("attrs") or {}
            alt = _escape_text(str(attrs.get("alt") or ""))
            src = str(attrs.get("src") or "").strip()
            if not src:
                continue
            parts.append(f"![{alt}]({src})")
        elif node_type == "hard_break":
            parts.append("\\\n")
    return "".join(parts)


def _render_list_item(node: Any, *, indent: int, marker: str) -> str:
    content = node.get("content") or []
    if not content:
        return " " * indent + f"{marker} \n"
    first = content[0] if content else None
    lines: list[str] = []
    if isinstance(first, dict) and str(first.get("type") or "") == "paragraph":
        lines.append(" " * indent + f"{marker} {_render_inline(first.get('content') or [])}")
        remaining = content[1:]
    else:
        lines.append(" " * indent + f"{marker}")
        remaining = content
    for child in remaining:
        rendered = _render_block(child, indent=indent + 2).rstrip("\n")
        if not rendered:
            continue
        for line in rendered.splitlines():
            lines.append(" " * (indent + 2) + line if line else "")
    return "\n".join(lines) + "\n"


def _render_table(node: Any, *, indent: int) -> str:
    rows = node.get("content") or []
    if not rows:
        return ""
    rendered_rows: list[list[str]] = []
    for row in rows:
        cells: list[str] = []
        for cell in row.get("content") or []:
            cell_content = cell.get("content") or []
            if cell_content and isinstance(cell_content[0], dict):
                cells.append(_render_inline(cell_content[0].get("content") or []))
            else:
                cells.append("")
        rendered_rows.append(cells)
    if not rendered_rows:
        return ""
    header = rendered_rows[0]
    body = rendered_rows[1:]
    lines = [
        " " * indent + "| " + " | ".join(header) + " |",
        " " * indent + "| " + " | ".join("-" for _ in header) + " |",
    ]
    for row in body:
        lines.append(" " * indent + "| " + " | ".join(row) + " |")
    return "\n".join(lines) + "\n"


def _render_block(node: Any, *, indent: int = 0) -> str:
    if not isinstance(node, dict):
        return ""
    node_type = str(node.get("type") or "")
    if node_type == "paragraph":
        return " " * indent + _render_inline(node.get("content") or []) + "\n"
    if node_type == "heading":
        level = int((node.get("attrs") or {}).get("level") or 1)
        return " " * indent + f"{'#' * max(1, min(level, 6))} {_render_inline(node.get('content') or [])}\n"
    if node_type == "blockquote":
        inner = "".join(_render_block(child, indent=0) for child in node.get("content") or []).strip("\n")
        if not inner:
            return ""
        return "\n".join(" " * indent + f"> {line}" if line else " " * indent + ">" for line in inner.splitlines()) + "\n"
    if node_type == "bullet_list":
        return "".join(_render_list_item(child, indent=indent, marker="-") for child in node.get("content") or [])
    if node_type == "ordered_list":
        start = int((node.get("attrs") or {}).get("start") or 1)
        out = []
        for index, child in enumerate(node.get("content") or []):
            out.append(_render_list_item(child, indent=indent, marker=f"{start + index}."))
        return "".join(out)
    if node_type == "task_list":
        out = []
        for child in node.get("content") or []:
            checked = bool((child.get("attrs") or {}).get("checked"))
            out.append(_render_list_item(child, indent=indent, marker="- [x]" if checked else "- [ ]"))
        return "".join(out)
    if node_type == "code_block":
        language = str((node.get("attrs") or {}).get("language") or "").strip()
        content = ""
        for child in node.get("content") or []:
            if isinstance(child, dict) and str(child.get("type") or "") == "text":
                content += str(child.get("text") or "")
        fence = f"```{language}".rstrip()
        return " " * indent + fence + "\n" + content + "\n" + " " * indent + "```\n"
    if node_type == "horizontal_rule":
        return " " * indent + "---\n"
    if node_type == "table":
        return _render_table(node, indent=indent)
    if node_type in {"list_item", "task_item"}:
        return _render_list_item(node, indent=indent, marker="-")
    return "".join(_render_block(child, indent=indent) for child in node.get("content") or [])


def tree_to_markdown(tree: Any) -> str:
    doc = normalize_tree(tree)
    blocks = []
    for child in doc.get("content") or []:
        rendered = _render_block(child).rstrip("\n")
        if rendered:
            blocks.append(rendered)
    return "\n\n".join(blocks).strip()

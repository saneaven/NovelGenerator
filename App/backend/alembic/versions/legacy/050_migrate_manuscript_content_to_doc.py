"""migrate_manuscript_content_to_doc

Revision ID: 050
Revises: 049
Create Date: 2026-01-19

- Convert legacy manuscript translation data from {content: str} to {doc: TipTapDoc, wordCount: int}
- Strip ALL inline images during migration (both markdown image syntax and doc image nodes)
- Clear manuscript_images index (it will rebuild on next manual save)
- Drop legacy manuscript_versions table (pre-unified versioning; unused)
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

import re
from typing import Any, Dict, List


revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


EMPTY_DOC: Dict[str, Any] = {"type": "doc", "content": [{"type": "paragraph"}]}

HR_RE = re.compile(r"^(?:-{3,}|\*{3,}|_{3,})\s*$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
BULLET_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
ORDERED_RE = re.compile(r"^\s*(\d+)\.\s+(.*)$")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
BLOCKQUOTE_RE = re.compile(r"^\s*>\s?(.*)$")


def _strip_markdown_images(md: str) -> str:
    if not md:
        return ""

    text = md
    # HTML <img ...>
    text = re.sub(r"<img\b[^>]*>", "", text, flags=re.IGNORECASE)
    # Markdown images: ![alt](url) and reference-style ![alt][id]
    text = re.sub(r"!\[[^\]]*\]\([^\)]*\)", "", text)
    text = re.sub(r"!\[[^\]]*\]\[[^\]]*\]", "", text)
    # Reference definitions: [id]: url
    text = re.sub(r"^\[[^\]]+\]:\s*\S+.*$", "", text, flags=re.MULTILINE)
    return text


def _clean_inline(text: str) -> str:
    if not text:
        return ""

    t = text

    # Images (inline) - remove just in case they appear mid-line
    t = re.sub(r"<img\b[^>]*>", "", t, flags=re.IGNORECASE)
    t = re.sub(r"!\[[^\]]*\]\([^\)]*\)", "", t)
    t = re.sub(r"!\[[^\]]*\]\[[^\]]*\]", "", t)

    # Links: [text](url) -> text
    t = re.sub(r"\[([^\]]+)\]\([^\)]*\)", r"\1", t)

    # Inline code/backticks
    t = re.sub(r"`([^`]+)`", r"\1", t)

    # Emphasis/strike (best-effort; not a full markdown parser)
    t = re.sub(r"\*\*([^*]+)\*\*", r"\1", t)
    t = re.sub(r"__([^_]+)__", r"\1", t)
    t = re.sub(r"\*([^*]+)\*", r"\1", t)
    t = re.sub(r"_([^_]+)_", r"\1", t)
    t = re.sub(r"~~([^~]+)~~", r"\1", t)

    # Collapse whitespace
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _text_node(text: str) -> Dict[str, Any]:
    return {"type": "text", "text": text}


def _paragraph_node(text: str) -> Dict[str, Any]:
    if not text:
        return {"type": "paragraph"}
    return {"type": "paragraph", "content": [_text_node(text)]}


def _heading_node(level: int, text: str) -> Dict[str, Any]:
    node: Dict[str, Any] = {"type": "heading", "attrs": {"level": level}}
    if text:
        node["content"] = [_text_node(text)]
    return node


def _list_item_node(text: str) -> Dict[str, Any]:
    return {"type": "listItem", "content": [_paragraph_node(text)]}


def _code_block_node(text: str) -> Dict[str, Any]:
    node: Dict[str, Any] = {"type": "codeBlock"}
    if text:
        node["content"] = [_text_node(text)]
    return node


def _is_block_start(line: str) -> bool:
    s = line.rstrip("\n")
    if not s.strip():
        return False
    if FENCE_RE.match(s):
        return True
    if HR_RE.match(s.strip()):
        return True
    if HEADING_RE.match(s):
        return True
    if s.lstrip().startswith(">"):
        return True
    if BULLET_RE.match(s):
        return True
    if ORDERED_RE.match(s):
        return True
    return False


def _parse_markdown_lines(lines: List[str]) -> List[Dict[str, Any]]:
    nodes: List[Dict[str, Any]] = []
    i = 0

    while i < len(lines):
        line = lines[i].rstrip("\n")
        if not line.strip():
            i += 1
            continue

        # Fenced code blocks
        fence_match = FENCE_RE.match(line)
        if fence_match:
            fence = fence_match.group(1)
            i += 1
            code_lines: List[str] = []
            while i < len(lines) and not lines[i].lstrip().startswith(fence):
                code_lines.append(lines[i].rstrip("\n"))
                i += 1
            if i < len(lines) and lines[i].lstrip().startswith(fence):
                i += 1
            nodes.append(_code_block_node("\n".join(code_lines).rstrip("\n")))
            continue

        # Horizontal rule
        if HR_RE.match(line.strip()):
            nodes.append({"type": "horizontalRule"})
            i += 1
            continue

        # Heading
        m = HEADING_RE.match(line)
        if m:
            level = len(m.group(1))
            text = _clean_inline(m.group(2))
            nodes.append(_heading_node(level, text))
            i += 1
            continue

        # Blockquote
        if line.lstrip().startswith(">"):
            quote_lines: List[str] = []
            while i < len(lines):
                m_q = BLOCKQUOTE_RE.match(lines[i].rstrip("\n"))
                if not m_q:
                    break
                quote_lines.append(m_q.group(1))
                i += 1
            inner = _parse_markdown_lines(quote_lines)
            if not inner:
                inner = [{"type": "paragraph"}]
            nodes.append({"type": "blockquote", "content": inner})
            continue

        # Bullet list
        m = BULLET_RE.match(line)
        if m:
            items: List[Dict[str, Any]] = []
            while i < len(lines):
                m2 = BULLET_RE.match(lines[i].rstrip("\n"))
                if not m2:
                    break
                items.append(_list_item_node(_clean_inline(m2.group(1))))
                i += 1
            nodes.append({"type": "bulletList", "content": items})
            continue

        # Ordered list
        m = ORDERED_RE.match(line)
        if m:
            items = []
            while i < len(lines):
                m2 = ORDERED_RE.match(lines[i].rstrip("\n"))
                if not m2:
                    break
                items.append(_list_item_node(_clean_inline(m2.group(2))))
                i += 1
            nodes.append({"type": "orderedList", "content": items})
            continue

        # Paragraph (consecutive non-empty non-block lines)
        para_lines: List[str] = []
        while i < len(lines):
            cur = lines[i].rstrip("\n")
            if not cur.strip():
                break
            if _is_block_start(cur) and para_lines:
                break
            if _is_block_start(cur) and not para_lines:
                # Defensive: avoid infinite loop if we missed a block above
                break
            para_lines.append(_clean_inline(cur.strip()))
            i += 1

        nodes.append(_paragraph_node(" ".join([p for p in para_lines if p]).strip()))

        # Skip blank lines after paragraph
        while i < len(lines) and not lines[i].strip():
            i += 1

    return nodes


def _markdown_to_doc(md: str) -> Dict[str, Any]:
    if not md or not md.strip():
        return dict(EMPTY_DOC)

    cleaned = _strip_markdown_images(md)
    nodes = _parse_markdown_lines(cleaned.splitlines())
    if not nodes:
        return dict(EMPTY_DOC)
    return {"type": "doc", "content": nodes}


def _strip_images_from_doc(doc: Any) -> Dict[str, Any]:
    def strip(node: Any) -> Any:
        if isinstance(node, dict):
            if node.get("type") == "image":
                return None
            content = node.get("content")
            if isinstance(content, list):
                next_content: List[Any] = []
                for child in content:
                    next_child = strip(child)
                    if next_child is None:
                        continue
                    next_content.append(next_child)
                new_node = dict(node)
                new_node["content"] = next_content
                return new_node
            return node
        if isinstance(node, list):
            out: List[Any] = []
            for child in node:
                next_child = strip(child)
                if next_child is None:
                    continue
                out.append(next_child)
            return out
        return node

    out = strip(doc)
    if not isinstance(out, dict) or out.get("type") != "doc":
        return dict(EMPTY_DOC)
    if not isinstance(out.get("content"), list) or not out["content"]:
        return dict(EMPTY_DOC)
    return out


def _doc_to_plain_text(doc: Any) -> str:
    out: List[str] = []
    block_break = {"paragraph", "heading", "blockquote", "listItem", "tableRow", "tableHeader"}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "text" and isinstance(node.get("text"), str):
                out.append(node["text"])
                return
            content = node.get("content")
            if isinstance(content, list):
                for child in content:
                    walk(child)
                if node.get("type") in block_break:
                    out.append("\n")
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(doc)
    text = "".join(out)
    return re.sub(r"\s+", " ", text).strip()


def _doc_word_count(doc: Any) -> int:
    text = _doc_to_plain_text(doc)
    if not text:
        return 0
    return len([w for w in re.split(r"\s+", text) if w])


def _migrate_manuscript_lang_data(lang_data: Any) -> Dict[str, Any]:
    if not isinstance(lang_data, dict):
        return {"doc": dict(EMPTY_DOC), "wordCount": 0}

    raw_doc = lang_data.get("doc")
    raw_content = lang_data.get("content")

    if isinstance(raw_doc, dict) and raw_doc.get("type") == "doc":
        doc = raw_doc
    elif isinstance(raw_content, str) and raw_content.strip():
        doc = _markdown_to_doc(raw_content)
    else:
        doc = dict(EMPTY_DOC)

    doc = _strip_images_from_doc(doc)

    word_count = lang_data.get("wordCount")
    if not isinstance(word_count, int):
        word_count = _doc_word_count(doc)

    return {"doc": doc, "wordCount": int(word_count)}


def upgrade() -> None:
    conn = op.get_bind()

    object_translations = sa.table(
        "object_translations",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("object_type", sa.String(length=50)),
        sa.column("data", postgresql.JSONB),
    )
    object_versions = sa.table(
        "object_versions",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("object_type", sa.String(length=50)),
        sa.column("data", postgresql.JSONB),
    )

    # 1) Translate cache: one row per language
    rows = conn.execute(
        sa.select(object_translations.c.id, object_translations.c.data).where(
            object_translations.c.object_type.in_(["manuscript", "chapter_content"])
        )
    ).fetchall()

    for row in rows:
        new_data = _migrate_manuscript_lang_data(row.data)
        conn.execute(
            object_translations.update()
            .where(object_translations.c.id == row.id)
            .values(data=new_data)
        )

    # 2) Version history: all languages packed in one JSONB
    versions = conn.execute(
        sa.select(object_versions.c.id, object_versions.c.data).where(
            object_versions.c.object_type.in_(["manuscript", "chapter_content"])
        )
    ).fetchall()

    for row in versions:
        packed = row.data
        if not isinstance(packed, dict):
            continue
        next_packed: Dict[str, Any] = {}
        for language, lang_data in packed.items():
            next_packed[language] = _migrate_manuscript_lang_data(lang_data)
        conn.execute(
            object_versions.update()
            .where(object_versions.c.id == row.id)
            .values(data=next_packed)
        )

    # 3) Wipe manuscript_images index (inline images were removed from doc)
    op.execute(sa.text("DELETE FROM manuscript_images"))

    # 4) Drop legacy manuscript_versions table (pre-unified versioning)
    op.execute(sa.text("DROP TABLE IF EXISTS manuscript_versions CASCADE"))


def downgrade() -> None:
    """
    Best-effort downgrade:
    - Recreate the legacy manuscript_versions table (empty; no data restoration)
    - Convert doc -> plain text and store back into {content, wordCount}

    NOTE: This downgrade does NOT restore formatting or images.
    """
    conn = op.get_bind()

    # 1) Recreate manuscript_versions (empty) if needed
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS manuscript_versions (
                id UUID PRIMARY KEY,
                manuscript_id UUID NOT NULL,
                user_request TEXT,
                is_active BOOLEAN NOT NULL DEFAULT FALSE,
                data JSONB NOT NULL,
                timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_manuscript_versions_manuscript
                    FOREIGN KEY (manuscript_id) REFERENCES manuscripts(id) ON DELETE CASCADE
            )
            """
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_manuscript_versions_manuscript_id ON manuscript_versions (manuscript_id)"
        )
    )

    object_translations = sa.table(
        "object_translations",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("object_type", sa.String(length=50)),
        sa.column("data", postgresql.JSONB),
    )
    object_versions = sa.table(
        "object_versions",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("object_type", sa.String(length=50)),
        sa.column("data", postgresql.JSONB),
    )

    # 2) object_translations: doc -> content
    rows = conn.execute(
        sa.select(object_translations.c.id, object_translations.c.data).where(
            object_translations.c.object_type.in_(["manuscript", "chapter_content"])
        )
    ).fetchall()

    for row in rows:
        data = row.data if isinstance(row.data, dict) else {}
        doc = data.get("doc")
        content = _doc_to_plain_text(doc)
        word_count = data.get("wordCount")
        if not isinstance(word_count, int):
            word_count = len([w for w in re.split(r"\s+", content) if w]) if content else 0
        conn.execute(
            object_translations.update()
            .where(object_translations.c.id == row.id)
            .values(data={"content": content, "wordCount": int(word_count)})
        )

    # 3) object_versions: doc -> content (per language)
    versions = conn.execute(
        sa.select(object_versions.c.id, object_versions.c.data).where(
            object_versions.c.object_type.in_(["manuscript", "chapter_content"])
        )
    ).fetchall()

    for row in versions:
        packed = row.data
        if not isinstance(packed, dict):
            continue
        next_packed: Dict[str, Any] = {}
        for language, lang_data in packed.items():
            lang_data_dict = lang_data if isinstance(lang_data, dict) else {}
            doc = lang_data_dict.get("doc")
            content = _doc_to_plain_text(doc)
            word_count = lang_data_dict.get("wordCount")
            if not isinstance(word_count, int):
                word_count = len([w for w in re.split(r"\s+", content) if w]) if content else 0
            next_packed[language] = {"content": content, "wordCount": int(word_count)}
        conn.execute(
            object_versions.update()
            .where(object_versions.c.id == row.id)
            .values(data=next_packed)
        )


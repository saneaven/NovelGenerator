"""Move image node title attr to alt in all stored content trees."""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0011_image_title_to_alt"
down_revision = "0010_text_file_attachment_kind"
branch_labels = None
depends_on = None

_RICH_TEXT_FIELDS: dict[str, tuple[str, ...]] = {
    "guidelines": ("authorNote",),
    "story_entity": ("content",),
    "outline": ("content",),
    "manuscript": ("content",),
    "timeline_track": ("content",),
    "timeline_event": ("content",),
}


def _rewrite_node(node: Any) -> Any:
    if not isinstance(node, dict):
        return node

    next_node = dict(node)
    if str(next_node.get("type") or "") == "image":
        attrs = next_node.get("attrs")
        if isinstance(attrs, dict):
            next_attrs = dict(attrs)
            title = next_attrs.pop("title", None)
            if title:
                next_attrs["alt"] = title
            next_node["attrs"] = next_attrs

    content = next_node.get("content")
    if isinstance(content, list):
        next_node["content"] = [_rewrite_node(child) for child in content]
    return next_node


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, object_type, data FROM object_versions")
    ).fetchall()

    for row_id, object_type, data in rows:
        if not isinstance(data, dict):
            continue
        fields = _RICH_TEXT_FIELDS.get(str(object_type or ""), ())
        if not fields:
            continue

        changed = False
        for _lang, lang_blob in data.items():
            if not isinstance(lang_blob, dict):
                continue
            for field in fields:
                tree = lang_blob.get(field)
                if not isinstance(tree, dict):
                    continue
                rewritten = _rewrite_node(tree)
                if rewritten is not tree:
                    lang_blob[field] = rewritten
                    changed = True

        if changed:
            conn.execute(
                sa.text("UPDATE object_versions SET data = :data WHERE id = :id"),
                {"data": json.dumps(data), "id": row_id},
            )


def downgrade() -> None:
    raise RuntimeError("0011_image_title_to_alt is irreversible")

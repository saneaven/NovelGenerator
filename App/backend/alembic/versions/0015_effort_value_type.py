"""Backfill value_type on existing custom thinking template effort fields."""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0015_effort_value_type"
down_revision = "0014_object_version_langs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, custom_thinking_templates FROM user_settings")
    ).fetchall()

    for row_id, templates in rows:
        if not isinstance(templates, list):
            continue

        changed = False
        for template in templates:
            if not isinstance(template, dict):
                continue
            fields = template.get("effort_fields")
            if not isinstance(fields, list):
                continue
            for field in fields:
                if isinstance(field, dict) and "value_type" not in field:
                    field["value_type"] = "string"
                    changed = True

        if changed:
            conn.execute(
                sa.text(
                    "UPDATE user_settings SET custom_thinking_templates = :t WHERE id = :id"
                ),
                {"t": json.dumps(templates), "id": row_id},
            )


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, custom_thinking_templates FROM user_settings")
    ).fetchall()

    for row_id, templates in rows:
        if not isinstance(templates, list):
            continue

        changed = False
        for template in templates:
            if not isinstance(template, dict):
                continue
            fields = template.get("effort_fields")
            if not isinstance(fields, list):
                continue
            for field in fields:
                if isinstance(field, dict) and field.pop("value_type", None) is not None:
                    changed = True

        if changed:
            conn.execute(
                sa.text(
                    "UPDATE user_settings SET custom_thinking_templates = :t WHERE id = :id"
                ),
                {"t": json.dumps(templates), "id": row_id},
            )

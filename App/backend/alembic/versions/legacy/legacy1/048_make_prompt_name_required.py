"""make_prompt_name_required

Revision ID: 048
Revises: 047
Create Date: 2026-01-18

Enforce that every prompt_version has a non-null prompt_name.

Data migration strategy:
- Convert existing NULL prompt_name rows to a reserved name (__default__).
- Fix NULL-name version_number collisions (Postgres UNIQUE index treats NULL as distinct).
- For presets that only have the legacy NULL-name prompt for a category, backfill the
  expected named prompts for that function_type/category by copying the latest content.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from datetime import datetime
import uuid


revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


DEFAULT_PROMPT_NAME = "__default__"

# Only these function types have a known, fixed set of prompt names in the current app.
EXPECTED_NAMES_BY_FUNCTION: dict[str, list[str]] = {
    "agent": ["storyObject", "novelEditor", "outlineManager"],
    "editAssistant": ["manuscript", "storyObject"],
    "imagePrompt": ["object", "scene", "coverImage"],
}


def _fetchall(conn, sql: str, params: dict | None = None):
    return conn.execute(sa.text(sql), params or {}).fetchall()


def _fetchone(conn, sql: str, params: dict | None = None):
    return conn.execute(sa.text(sql), params or {}).fetchone()


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.utcnow()

    # 1) Fix version_number collisions within NULL-name groups by re-numbering
    #    sequentially in created_at order. This prevents UNIQUE index violations once
    #    we set prompt_name to a non-NULL value.
    null_groups = _fetchall(
        conn,
        """
        SELECT preset_id, function_type, prompt_category
        FROM prompt_versions
        WHERE prompt_name IS NULL
        GROUP BY preset_id, function_type, prompt_category
        """,
    )

    for (preset_id, function_type, prompt_category) in null_groups:
        rows = _fetchall(
            conn,
            """
            SELECT id
            FROM prompt_versions
            WHERE preset_id = :preset_id
              AND function_type = :function_type
              AND prompt_category = :prompt_category
              AND prompt_name IS NULL
            ORDER BY created_at ASC, id ASC
            """,
            {
                "preset_id": preset_id,
                "function_type": function_type,
                "prompt_category": prompt_category,
            },
        )

        # Re-number 1..N for deterministic ordering.
        for idx, (row_id,) in enumerate(rows, start=1):
            conn.execute(
                sa.text(
                    """
                    UPDATE prompt_versions
                    SET version_number = :vn
                    WHERE id = :id
                    """
                ),
                {"vn": idx, "id": row_id},
            )

    # 2) Convert all NULL prompt_name rows to DEFAULT_PROMPT_NAME
    conn.execute(
        sa.text(
            """
            UPDATE prompt_versions
            SET prompt_name = :default_name
            WHERE prompt_name IS NULL
            """
        ),
        {"default_name": DEFAULT_PROMPT_NAME},
    )

    # 3) Backfill missing expected named prompts from the __default__ prompt, per preset.
    #    This fixes presets created via the buggy export/import that lost the named prompts.
    default_groups = _fetchall(
        conn,
        """
        SELECT preset_id, user_id, function_type, prompt_category
        FROM prompt_versions
        WHERE prompt_name = :default_name
        GROUP BY preset_id, user_id, function_type, prompt_category
        """,
        {"default_name": DEFAULT_PROMPT_NAME},
    )

    for (preset_id, user_id, function_type, prompt_category) in default_groups:
        expected_names = EXPECTED_NAMES_BY_FUNCTION.get(function_type)
        if not expected_names:
            continue

        latest = _fetchone(
            conn,
            """
            SELECT content, is_default
            FROM prompt_versions
            WHERE preset_id = :preset_id
              AND function_type = :function_type
              AND prompt_category = :prompt_category
              AND prompt_name = :default_name
            ORDER BY version_number DESC
            LIMIT 1
            """,
            {
                "preset_id": preset_id,
                "function_type": function_type,
                "prompt_category": prompt_category,
                "default_name": DEFAULT_PROMPT_NAME,
            },
        )
        if not latest:
            continue

        for prompt_name in expected_names:
            exists = _fetchone(
                conn,
                """
                SELECT 1
                FROM prompt_versions
                WHERE preset_id = :preset_id
                  AND function_type = :function_type
                  AND prompt_category = :prompt_category
                  AND prompt_name = :prompt_name
                LIMIT 1
                """,
                {
                    "preset_id": preset_id,
                    "function_type": function_type,
                    "prompt_category": prompt_category,
                    "prompt_name": prompt_name,
                },
            )
            if exists:
                continue

            conn.execute(
                sa.text(
                    """
                    INSERT INTO prompt_versions (
                        id, user_id, preset_id,
                        function_type, prompt_category, prompt_name,
                        content, version_number, is_default,
                        created_at, note
                    )
                    VALUES (
                        :id, :user_id, :preset_id,
                        :function_type, :prompt_category, :prompt_name,
                        :content, :version_number, :is_default,
                        :created_at, :note
                    )
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "user_id": user_id,
                    "preset_id": preset_id,
                    "function_type": function_type,
                    "prompt_category": prompt_category,
                    "prompt_name": prompt_name,
                    "content": latest.content,
                    "version_number": 1,
                    "is_default": bool(latest.is_default),
                    "created_at": now,
                    "note": f"Migrated from {DEFAULT_PROMPT_NAME}",
                },
            )

    # 4) Enforce prompt_name NOT NULL at the schema level.
    op.alter_column("prompt_versions", "prompt_name", nullable=False)


def downgrade() -> None:
    # Best-effort downgrade: allow NULL again.
    op.alter_column("prompt_versions", "prompt_name", nullable=True)


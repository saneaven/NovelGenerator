"""Replace asset-only quota with total project storage usage.

Revision ID: 0010_total_project_storage_usage
Revises: 0009_notifications_use_image_run_source
Create Date: 2026-03-07
"""

from __future__ import annotations

import json
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0010_total_project_storage_usage"
down_revision = "0009_notifications_use_image_run_source"
branch_labels = None
depends_on = None


def _measure_value(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    if isinstance(value, (dict, list)):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        return len(payload.encode("utf-8"))
    return 0


def _fetch_rows(bind: sa.engine.Connection, sql: str, **params: object) -> list[sa.RowMapping]:
    return list(bind.execute(sa.text(sql), params).mappings())


def _sum_rows(rows: list[sa.RowMapping], *keys: str) -> int:
    total = 0
    for row in rows:
        for key in keys:
            total += _measure_value(row.get(key))
    return total


def _sum_object_versions(bind: sa.engine.Connection, sql: str, *, project_id: object) -> int:
    rows = _fetch_rows(bind, sql, project_id=project_id)
    return _sum_rows(rows, "data", "user_request")


def _compute_project_usage(bind: sa.engine.Connection, *, project_id: object, user_id: object, name: object, description: object) -> dict[str, object]:
    project_meta_bytes = _measure_value(name) + _measure_value(description)

    story_bytes = 0
    story_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT image_prompt, image_prompt_positive, image_prompt_negative
            FROM basic_info
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "image_prompt",
        "image_prompt_positive",
        "image_prompt_negative",
    )
    story_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT image_prompt, image_prompt_positive, image_prompt_negative
            FROM characters
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "image_prompt",
        "image_prompt_positive",
        "image_prompt_negative",
    )
    story_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT image_prompt, image_prompt_positive, image_prompt_negative
            FROM organizations
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "image_prompt",
        "image_prompt_positive",
        "image_prompt_negative",
    )
    story_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT image_prompt, image_prompt_positive, image_prompt_negative
            FROM locations
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "image_prompt",
        "image_prompt_positive",
        "image_prompt_negative",
    )
    story_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT image_prompt, image_prompt_positive, image_prompt_negative
            FROM lorebook_entries
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "image_prompt",
        "image_prompt_positive",
        "image_prompt_negative",
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN basic_info row_ref
          ON ov.object_type = 'basic_info'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN guidelines row_ref
          ON ov.object_type = 'guidelines'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN characters row_ref
          ON ov.object_type = 'character'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN organizations row_ref
          ON ov.object_type = 'organization'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN locations row_ref
          ON ov.object_type = 'location'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN lorebook_entries row_ref
          ON ov.object_type = 'lorebook'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN outlines row_ref
          ON ov.object_type = 'outline'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN acts row_ref
          ON ov.object_type = 'act'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    story_bytes += _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN chapters row_ref
          ON ov.object_type = 'chapter'
         AND ov.object_id = row_ref.id
        WHERE row_ref.project_id = :project_id
        """,
        project_id=project_id,
    )

    manuscript_bytes = _sum_object_versions(
        bind,
        """
        SELECT ov.data, ov.user_request
        FROM object_versions ov
        JOIN manuscripts row_ref
          ON ov.object_type = 'manuscript'
         AND ov.object_id = row_ref.id
        JOIN chapters chapter_ref
          ON chapter_ref.id = row_ref.chapter_id
        WHERE chapter_ref.project_id = :project_id
        """,
        project_id=project_id,
    )
    manuscript_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT mi.generation_prompt, mi.caption
            FROM manuscript_images mi
            JOIN manuscripts m ON m.id = mi.manuscript_id
            JOIN chapters c ON c.id = m.chapter_id
            WHERE c.project_id = :project_id
            """,
            project_id=project_id,
        ),
        "generation_prompt",
        "caption",
    )

    chat_bytes = 0
    chat_bytes += _sum_rows(
        _fetch_rows(
            bind,
            "SELECT name FROM agents WHERE project_id = :project_id",
            project_id=project_id,
        ),
        "name",
    )
    chat_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT captured_history_system_prompt, captured_history_conversation_json
            FROM threads
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "captured_history_system_prompt",
        "captured_history_conversation_json",
    )
    chat_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT error, context_object_ids, journey_target_ids, input_payload
            FROM runs
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "error",
        "context_object_ids",
        "journey_target_ids",
        "input_payload",
    )
    chat_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT rm.data
            FROM run_messages rm
            JOIN runs r ON r.id = rm.run_id
            WHERE r.project_id = :project_id
            """,
            project_id=project_id,
        ),
        "data",
    )
    chat_bytes += _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT rtc.arguments, rtc.extra_content, rtc.reason, rtc.result
            FROM run_tool_calls rtc
            JOIN runs r ON r.id = rtc.run_id
            WHERE r.project_id = :project_id
            """,
            project_id=project_id,
        ),
        "arguments",
        "extra_content",
        "reason",
        "result",
    )

    notification_bytes = _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT label, message, warning, progress_json, custom_slot_json, meta_json
            FROM notifications
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "label",
        "message",
        "warning",
        "progress_json",
        "custom_slot_json",
        "meta_json",
    )

    image_run_bytes = _sum_rows(
        _fetch_rows(
            bind,
            """
            SELECT request_snapshot, revised_prompt, before_excerpt, after_excerpt, failure_code, error_message
            FROM image_runs
            WHERE project_id = :project_id
            """,
            project_id=project_id,
        ),
        "request_snapshot",
        "revised_prompt",
        "before_excerpt",
        "after_excerpt",
        "failure_code",
        "error_message",
    )

    image_bytes = 0
    for row in _fetch_rows(
        bind,
        """
        SELECT
            name,
            file_size,
            generation_prompt,
            generation_positive_prompt,
            generation_negative_prompt,
            generation_settings,
            generation_reference_images,
            generation_reference_objects
        FROM assets
        WHERE project_id = :project_id
        """,
        project_id=project_id,
    ):
        image_bytes += int(row.get("file_size") or 0)
        image_bytes += _measure_value(row.get("name"))
        image_bytes += _measure_value(row.get("generation_prompt"))
        image_bytes += _measure_value(row.get("generation_positive_prompt"))
        image_bytes += _measure_value(row.get("generation_negative_prompt"))
        image_bytes += _measure_value(row.get("generation_settings"))
        image_bytes += _measure_value(row.get("generation_reference_images"))
        image_bytes += _measure_value(row.get("generation_reference_objects"))

    total_bytes = (
        int(project_meta_bytes)
        + int(story_bytes)
        + int(manuscript_bytes)
        + int(chat_bytes)
        + int(notification_bytes)
        + int(image_run_bytes)
        + int(image_bytes)
    )

    return {
        "id": uuid.uuid4(),
        "project_id": project_id,
        "user_id": user_id,
        "project_meta_bytes": int(project_meta_bytes),
        "story_bytes": int(story_bytes),
        "manuscript_bytes": int(manuscript_bytes),
        "chat_bytes": int(chat_bytes),
        "notification_bytes": int(notification_bytes),
        "image_run_bytes": int(image_run_bytes),
        "image_bytes": int(image_bytes),
        "total_bytes": int(total_bytes),
    }


def upgrade() -> None:
    bind = op.get_bind()
    op.alter_column(
        "users",
        "asset_quota_bytes",
        new_column_name="storage_quota_bytes",
        existing_type=sa.BigInteger(),
        existing_nullable=True,
    )
    op.create_table(
        "project_storage_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_meta_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("story_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("manuscript_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("chat_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("notification_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("image_run_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("image_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id"),
    )
    op.create_index("ix_project_storage_usage_user_id", "project_storage_usage", ["user_id"], unique=False)
    project_rows = _fetch_rows(
        bind,
        "SELECT id, user_id, name, description FROM projects ORDER BY created_at ASC",
    )
    if project_rows:
        payload = [
            _compute_project_usage(
                bind,
                project_id=row["id"],
                user_id=row["user_id"],
                name=row.get("name"),
                description=row.get("description"),
            )
            for row in project_rows
        ]
        bind.execute(
            sa.text(
                """
                INSERT INTO project_storage_usage (
                    id,
                    project_id,
                    user_id,
                    project_meta_bytes,
                    story_bytes,
                    manuscript_bytes,
                    chat_bytes,
                    notification_bytes,
                    image_run_bytes,
                    image_bytes,
                    total_bytes
                ) VALUES (
                    :id,
                    :project_id,
                    :user_id,
                    :project_meta_bytes,
                    :story_bytes,
                    :manuscript_bytes,
                    :chat_bytes,
                    :notification_bytes,
                    :image_run_bytes,
                    :image_bytes,
                    :total_bytes
                )
                """
            ),
            payload,
        )


def downgrade() -> None:
    op.drop_index("ix_project_storage_usage_user_id", table_name="project_storage_usage")
    op.drop_table("project_storage_usage")
    op.alter_column(
        "users",
        "storage_quota_bytes",
        new_column_name="asset_quota_bytes",
        existing_type=sa.BigInteger(),
        existing_nullable=True,
    )

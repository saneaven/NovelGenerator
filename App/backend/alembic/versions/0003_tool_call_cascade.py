"""Restructure FK cascades: tool call parents its messages, assistant message parents its tool calls.

Revision ID: 0003_tool_call_cascade
Revises: 0002_runtime_rebuild_v1
Create Date: 2026-02-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0003_tool_call_cascade"
down_revision = "0002_runtime_rebuild_v1"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(c.get("name") == column for c in inspector.get_columns(table))


def _has_index(inspector: sa.Inspector, table: str, index_name: str) -> bool:
    return any(i.get("name") == index_name for i in inspector.get_indexes(table))


def _find_fk_name(inspector: sa.Inspector, table: str, column: str) -> str | None:
    for fk in inspector.get_foreign_keys(table):
        if column in (fk.get("constrained_columns") or []):
            return fk.get("name")
    return None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # ── 1. Add parent_tool_call_id to run_messages ──────────────────────
    if "run_messages" in tables and not _has_column(inspector, "run_messages", "parent_tool_call_id"):
        op.add_column(
            "run_messages",
            sa.Column("parent_tool_call_id", sa.UUID(), nullable=True),
        )

    # ── 2. Data migration: populate parent_tool_call_id from existing tool calls ──
    if "run_tool_calls" in tables and "run_messages" in tables:
        # Link tool_call messages to their parent tool call
        op.execute(
            """
            UPDATE run_messages
            SET parent_tool_call_id = tc.id
            FROM run_tool_calls tc
            WHERE run_messages.id = tc.message_id
              AND run_messages.parent_tool_call_id IS NULL
            """
        )
        # Link tool_result messages to their parent tool call
        op.execute(
            """
            UPDATE run_messages
            SET parent_tool_call_id = tc.id
            FROM run_tool_calls tc
            WHERE run_messages.id = tc.result_message_id
              AND run_messages.parent_tool_call_id IS NULL
            """
        )

    # ── 3. Add FK + index for parent_tool_call_id ───────────────────────
    if "run_messages" in tables and _has_column(inspector, "run_messages", "parent_tool_call_id"):
        op.create_foreign_key(
            "fk_run_messages_parent_tool_call_id",
            "run_messages",
            "run_tool_calls",
            ["parent_tool_call_id"],
            ["id"],
            ondelete="CASCADE",
        )
        if not _has_index(inspector, "run_messages", "ix_run_messages_parent_tool_call"):
            op.create_index(
                "ix_run_messages_parent_tool_call",
                "run_messages",
                ["parent_tool_call_id"],
            )

    # ── 4. Change message_id FK: CASCADE → SET NULL, make nullable ──────
    if "run_tool_calls" in tables:
        fk_name = _find_fk_name(inspector, "run_tool_calls", "message_id")
        if fk_name:
            op.drop_constraint(fk_name, "run_tool_calls", type_="foreignkey")
        op.alter_column("run_tool_calls", "message_id", nullable=True)
        op.create_foreign_key(
            "fk_run_tool_calls_message_id",
            "run_tool_calls",
            "run_messages",
            ["message_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # ── 5. Change assistant_message_id FK: SET NULL → CASCADE ───────────
    if "run_tool_calls" in tables:
        fk_name = _find_fk_name(inspector, "run_tool_calls", "assistant_message_id")
        if fk_name:
            op.drop_constraint(fk_name, "run_tool_calls", type_="foreignkey")
        op.create_foreign_key(
            "fk_run_tool_calls_assistant_message_id",
            "run_tool_calls",
            "run_messages",
            ["assistant_message_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # Restore assistant_message_id FK to SET NULL
    if "run_tool_calls" in tables:
        fk_name = _find_fk_name(inspector, "run_tool_calls", "assistant_message_id")
        if fk_name:
            op.drop_constraint(fk_name, "run_tool_calls", type_="foreignkey")
        op.create_foreign_key(
            "fk_run_tool_calls_assistant_message_id",
            "run_tool_calls",
            "run_messages",
            ["assistant_message_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # Restore message_id FK to CASCADE, non-nullable
    if "run_tool_calls" in tables:
        fk_name = _find_fk_name(inspector, "run_tool_calls", "message_id")
        if fk_name:
            op.drop_constraint(fk_name, "run_tool_calls", type_="foreignkey")
        op.alter_column("run_tool_calls", "message_id", nullable=False)
        op.create_foreign_key(
            "fk_run_tool_calls_message_id",
            "run_tool_calls",
            "run_messages",
            ["message_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Drop parent_tool_call_id from run_messages
    if "run_messages" in tables:
        if _has_index(inspector, "run_messages", "ix_run_messages_parent_tool_call"):
            op.drop_index("ix_run_messages_parent_tool_call", table_name="run_messages")
        fk_name = _find_fk_name(inspector, "run_messages", "parent_tool_call_id")
        if fk_name:
            op.drop_constraint(fk_name, "run_messages", type_="foreignkey")
        if _has_column(inspector, "run_messages", "parent_tool_call_id"):
            op.drop_column("run_messages", "parent_tool_call_id")

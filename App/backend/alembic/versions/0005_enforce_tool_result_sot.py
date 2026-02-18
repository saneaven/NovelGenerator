"""Enforce tool-result single source of truth on run_tool_calls.

Revision ID: 0005_enforce_tool_result_sot
Revises: 0004_drop_run_data_columns
Create Date: 2026-02-18
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005_enforce_tool_result_sot"
down_revision = "0004_drop_run_data_columns"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(c.get("name") == column for c in inspector.get_columns(table))


def _has_index(inspector: sa.Inspector, table: str, index_name: str) -> bool:
    return any(i.get("name") == index_name for i in inspector.get_indexes(table))


def _find_fk_name(inspector: sa.Inspector, table: str, column: str) -> str | None:
    for fk in inspector.get_foreign_keys(table):
        constrained_columns = fk.get("constrained_columns") or []
        if column in constrained_columns:
            return fk.get("name")
    return None


def _drop_constraint_if_exists(table: str, name: str) -> None:
    op.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}')


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "run_messages" in tables:
        # Existing DB data is non-production: remove legacy tool_result rows.
        op.execute("DELETE FROM run_messages WHERE role = 'tool_result'")

        _drop_constraint_if_exists("run_messages", "ck_run_messages_role")
        op.create_check_constraint(
            "ck_run_messages_role",
            "run_messages",
            "role IN ('system','user','assistant','tool_call')",
        )

    if "run_tool_calls" in tables and _has_column(inspector, "run_tool_calls", "result_message_id"):
        fk_name = _find_fk_name(inspector, "run_tool_calls", "result_message_id")
        if fk_name:
            op.drop_constraint(fk_name, "run_tool_calls", type_="foreignkey")

        if _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_result_message_id"):
            op.drop_index("ix_run_tool_calls_result_message_id", table_name="run_tool_calls")

        op.drop_column("run_tool_calls", "result_message_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "run_tool_calls" in tables and not _has_column(inspector, "run_tool_calls", "result_message_id"):
        op.add_column(
            "run_tool_calls",
            sa.Column("result_message_id", sa.UUID(), nullable=True),
        )
        op.create_foreign_key(
            "fk_run_tool_calls_result_message_id",
            "run_tool_calls",
            "run_messages",
            ["result_message_id"],
            ["id"],
            ondelete="SET NULL",
        )
        if not _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_result_message_id"):
            op.create_index("ix_run_tool_calls_result_message_id", "run_tool_calls", ["result_message_id"])

    if "run_messages" in tables:
        _drop_constraint_if_exists("run_messages", "ck_run_messages_role")
        op.create_check_constraint(
            "ck_run_messages_role",
            "run_messages",
            "role IN ('system','user','assistant','tool_call','tool_result')",
        )

"""Runtime rebuild v1: unify statuses and tool-call linkage.

Revision ID: 0002_runtime_rebuild_v1
Revises: 0001_baseline
Create Date: 2026-02-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0002_runtime_rebuild_v1"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(c.get("name") == column for c in inspector.get_columns(table))


def _has_index(inspector: sa.Inspector, table: str, index_name: str) -> bool:
    return any(i.get("name") == index_name for i in inspector.get_indexes(table))


def _drop_constraint_if_exists(table: str, name: str) -> None:
    op.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}')


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "threads" in tables:
        _drop_constraint_if_exists("threads", "ck_threads_status")
        op.create_check_constraint(
            "ck_threads_status",
            "threads",
            "status IN ('running','waiting','processing','paused','done','error','canceled')",
        )

        if not _has_column(inspector, "threads", "next_message_seq"):
            op.add_column(
                "threads",
                sa.Column("next_message_seq", sa.BigInteger(), nullable=False, server_default="1"),
            )

    if "runs" in tables:
        _drop_constraint_if_exists("runs", "ck_runs_status")
        op.create_check_constraint(
            "ck_runs_status",
            "runs",
            "status IN ('running','waiting','processing','paused','done','error','canceled')",
        )

    if "run_messages" in tables:
        _drop_constraint_if_exists("run_messages", "ck_run_messages_role")
        op.create_check_constraint(
            "ck_run_messages_role",
            "run_messages",
            "role IN ('system','user','assistant','tool_call','tool_result')",
        )

    if "run_tool_calls" in tables:
        if not _has_column(inspector, "run_tool_calls", "assistant_message_id"):
            op.add_column(
                "run_tool_calls",
                sa.Column("assistant_message_id", sa.UUID(), nullable=True),
            )
            op.create_foreign_key(
                "fk_run_tool_calls_assistant_message_id",
                "run_tool_calls",
                "run_messages",
                ["assistant_message_id"],
                ["id"],
                ondelete="SET NULL",
            )

        if not _has_column(inspector, "run_tool_calls", "result_message_id"):
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

        _drop_constraint_if_exists("run_tool_calls", "ck_run_tool_calls_status")
        op.create_check_constraint(
            "ck_run_tool_calls_status",
            "run_tool_calls",
            "status IN ('streaming','validating','pending','processing','failed','rejected','applied')",
        )

        if _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_status"):
            op.drop_index("ix_run_tool_calls_status", table_name="run_tool_calls")

        if not _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_thread_status"):
            op.create_index(
                "ix_run_tool_calls_thread_status",
                "run_tool_calls",
                ["thread_id", "status"],
            )

        if not _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_assistant_message"):
            op.create_index(
                "ix_run_tool_calls_assistant_message",
                "run_tool_calls",
                ["assistant_message_id"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "run_tool_calls" in tables:
        if _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_assistant_message"):
            op.drop_index("ix_run_tool_calls_assistant_message", table_name="run_tool_calls")
        if _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_thread_status"):
            op.drop_index("ix_run_tool_calls_thread_status", table_name="run_tool_calls")
        if not _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_status"):
            op.create_index("ix_run_tool_calls_status", "run_tool_calls", ["status"])

        _drop_constraint_if_exists("run_tool_calls", "ck_run_tool_calls_status")
        op.create_check_constraint(
            "ck_run_tool_calls_status",
            "run_tool_calls",
            "status IN ('pending','running','accepted','rejected','failed')",
        )

        if _has_column(inspector, "run_tool_calls", "assistant_message_id"):
            op.drop_constraint("fk_run_tool_calls_assistant_message_id", "run_tool_calls", type_="foreignkey")
            op.drop_column("run_tool_calls", "assistant_message_id")
        if _has_column(inspector, "run_tool_calls", "result_message_id"):
            op.drop_constraint("fk_run_tool_calls_result_message_id", "run_tool_calls", type_="foreignkey")
            op.drop_column("run_tool_calls", "result_message_id")

    if "run_messages" in tables:
        _drop_constraint_if_exists("run_messages", "ck_run_messages_role")
        op.create_check_constraint(
            "ck_run_messages_role",
            "run_messages",
            "role IN ('user','assistant','system','tool')",
        )

    if "runs" in tables:
        _drop_constraint_if_exists("runs", "ck_runs_status")
        op.create_check_constraint(
            "ck_runs_status",
            "runs",
            "status IN ('running','waiting','paused','completed','error','cancelled')",
        )

    if "threads" in tables:
        if _has_column(inspector, "threads", "next_message_seq"):
            op.drop_column("threads", "next_message_seq")
        _drop_constraint_if_exists("threads", "ck_threads_status")
        op.create_check_constraint(
            "ck_threads_status",
            "threads",
            "status IN ('idle','running','waiting_tools','paused','error')",
        )

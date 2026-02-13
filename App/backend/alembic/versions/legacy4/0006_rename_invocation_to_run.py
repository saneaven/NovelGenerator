"""Rename sub_agent_invocations → sub_agent_runs and add next_message_seq.

Revision ID: 0006_rename_invocation_to_run
Revises: 0005_unify_sub_agent_waiting_status
Create Date: 2026-02-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0006_rename_invocation_to_run"
down_revision = "0005_unify_sub_agent_waiting_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    # --- Rename sub_agent_invocation_messages → sub_agent_run_messages ---
    if "sub_agent_invocation_messages" in tables:
        op.rename_table("sub_agent_invocation_messages", "sub_agent_run_messages")
        op.alter_column("sub_agent_run_messages", "invocation_id", new_column_name="run_id")

        # Drop old constraints/indexes and recreate with new names
        try:
            op.drop_constraint("uq_sub_agent_invocation_messages_invocation_seq", "sub_agent_run_messages", type_="unique")
        except Exception:
            pass
        op.create_unique_constraint("uq_sub_agent_run_messages_run_seq", "sub_agent_run_messages", ["run_id", "seq"])

        try:
            op.drop_index("ix_sub_agent_invocation_messages_invocation_id", table_name="sub_agent_run_messages")
        except Exception:
            pass
        op.create_index("ix_sub_agent_run_messages_run_id", "sub_agent_run_messages", ["run_id"])

        try:
            op.drop_index("ix_sub_agent_invocation_messages_invocation_created", table_name="sub_agent_run_messages")
        except Exception:
            pass
        op.create_index("ix_sub_agent_run_messages_run_created", "sub_agent_run_messages", ["run_id", "created_at"])

    # --- Rename sub_agent_invocations → sub_agent_runs ---
    if "sub_agent_invocations" in tables:
        # Drop old check constraint before rename
        try:
            op.drop_constraint("ck_sub_agent_invocations_status", "sub_agent_invocations", type_="check")
        except Exception:
            pass

        op.rename_table("sub_agent_invocations", "sub_agent_runs")

        # Add next_message_seq column
        op.add_column("sub_agent_runs", sa.Column("next_message_seq", sa.BigInteger(), nullable=False, server_default="1"))

        # Drop old constraints/indexes and recreate with new names
        try:
            op.drop_constraint("uq_sub_agent_invocation_parent_tool", "sub_agent_runs", type_="unique")
        except Exception:
            pass
        op.create_unique_constraint(
            "uq_sub_agent_run_parent_tool",
            "sub_agent_runs",
            ["parent_type", "parent_id", "parent_message_id", "parent_tool_call_id"],
        )

        # Recreate check constraint with new name
        op.create_check_constraint(
            "ck_sub_agent_runs_status",
            "sub_agent_runs",
            "status IN ('running','waiting','paused','completed','error','cancelled')",
        )

        # Rename indexes
        try:
            op.drop_index("ix_sub_agent_invocations_project_agent_parent_message", table_name="sub_agent_runs")
        except Exception:
            pass
        op.create_index("ix_sub_agent_runs_project_agent_parent_message", "sub_agent_runs", ["project_id", "agent_id", "parent_message_id"])

        try:
            op.drop_index("ix_sub_agent_invocations_parent_ref", table_name="sub_agent_runs")
        except Exception:
            pass
        op.create_index("ix_sub_agent_runs_parent_ref", "sub_agent_runs", ["parent_type", "parent_id", "parent_message_id"])

        try:
            op.drop_index("ix_sub_agent_invocations_status", table_name="sub_agent_runs")
        except Exception:
            pass
        op.create_index("ix_sub_agent_runs_status", "sub_agent_runs", ["status"])

        # Rename auto-generated column indexes (created via index=True on Column)
        try:
            op.drop_index("ix_sub_agent_invocations_project_id", table_name="sub_agent_runs")
        except Exception:
            pass
        try:
            op.drop_index("ix_sub_agent_invocations_agent_id", table_name="sub_agent_runs")
        except Exception:
            pass
        try:
            op.drop_index("ix_sub_agent_invocations_sub_agent_id", table_name="sub_agent_runs")
        except Exception:
            pass

        # Backfill next_message_seq from existing message counts
        bind.execute(sa.text("""
            UPDATE sub_agent_runs r
            SET next_message_seq = COALESCE(
                (SELECT MAX(m.seq) + 1 FROM sub_agent_run_messages m WHERE m.run_id = r.id),
                1
            )
        """))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "sub_agent_runs" in tables:
        op.drop_column("sub_agent_runs", "next_message_seq")

        try:
            op.drop_constraint("ck_sub_agent_runs_status", "sub_agent_runs", type_="check")
        except Exception:
            pass

        try:
            op.drop_constraint("uq_sub_agent_run_parent_tool", "sub_agent_runs", type_="unique")
        except Exception:
            pass

        op.rename_table("sub_agent_runs", "sub_agent_invocations")

        op.create_unique_constraint(
            "uq_sub_agent_invocation_parent_tool",
            "sub_agent_invocations",
            ["parent_type", "parent_id", "parent_message_id", "parent_tool_call_id"],
        )
        op.create_check_constraint(
            "ck_sub_agent_invocations_status",
            "sub_agent_invocations",
            "status IN ('running','waiting','paused','completed','error','cancelled')",
        )

    if "sub_agent_run_messages" in tables:
        try:
            op.drop_constraint("uq_sub_agent_run_messages_run_seq", "sub_agent_run_messages", type_="unique")
        except Exception:
            pass

        op.alter_column("sub_agent_run_messages", "run_id", new_column_name="invocation_id")
        op.rename_table("sub_agent_run_messages", "sub_agent_invocation_messages")

        op.create_unique_constraint(
            "uq_sub_agent_invocation_messages_invocation_seq",
            "sub_agent_invocation_messages",
            ["invocation_id", "seq"],
        )

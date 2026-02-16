"""Add threads table and restructure runtime tables.

Destructive migration — drops all existing runtime data (runs, messages, tool calls)
and recreates with thread-centric schema.  Early development, no backward compatibility.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0004_add_threads"
down_revision = "0003_unified_runs_v3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Drop old runtime tables (order matters for FK cascade)
    # ------------------------------------------------------------------
    op.drop_table("run_tool_calls")
    op.drop_table("run_messages")
    op.drop_table("runs")

    # ------------------------------------------------------------------
    # 2. Remove next_root_run_seq from agents (replaced by thread.next_run_seq)
    # ------------------------------------------------------------------
    op.drop_column("agents", "next_root_run_seq")

    # ------------------------------------------------------------------
    # 3. Create threads table
    # ------------------------------------------------------------------
    op.create_table(
        "threads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("thread_type", sa.String(20), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("journey_kind", sa.String(40), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="idle"),
        sa.Column("captured_history_json", postgresql.JSONB, nullable=True),
        sa.Column("captured_from_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("next_run_seq", sa.BigInteger, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("thread_type IN ('agent','subAgent','journey')", name="ck_threads_type"),
        sa.CheckConstraint("status IN ('idle','running','waiting_tools','paused','error')", name="ck_threads_status"),
    )
    op.create_index("ix_threads_project_id", "threads", ["project_id"])
    op.create_index("ix_threads_user_id", "threads", ["user_id"])
    op.create_index("ix_threads_project_type", "threads", ["project_id", "thread_type"])
    op.create_index("ix_threads_owner", "threads", ["owner_id"])

    # ------------------------------------------------------------------
    # 4. Recreate runs table (thread-centric, no agent_id / sub_agent_id / journey_kind)
    # ------------------------------------------------------------------
    op.create_table(
        "runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("run_seq", sa.BigInteger, nullable=True),
        sa.Column("language", sa.String(50), nullable=False),
        sa.Column("input_text", sa.Text, nullable=False, server_default=""),
        sa.Column("input_payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("final_output", sa.Text, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        # Agent-only per-run metadata
        sa.Column("run_mode", sa.String(20), nullable=True),
        sa.Column("surface", sa.String(40), nullable=True),
        sa.Column("context_object_ids", postgresql.JSONB, nullable=False, server_default="[]"),
        # Journey-only per-run metadata
        sa.Column("journey_target_ids", postgresql.JSONB, nullable=False, server_default="[]"),
        # Sub-agent parent link
        sa.Column("parent_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=True),
        sa.Column("parent_run_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parent_run_tool_call_id", sa.String(255), nullable=True),
        sa.Column("next_message_seq", sa.BigInteger, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('running','waiting','paused','completed','error','cancelled')",
            name="ck_runs_status",
        ),
    )
    op.create_index("ix_runs_thread_id", "runs", ["thread_id"])
    op.create_index("ix_runs_thread_status", "runs", ["thread_id", "status"])
    op.create_index("ix_runs_project_status", "runs", ["project_id", "status"])
    op.create_index("ix_runs_parent", "runs", ["parent_run_id"])
    op.create_index(
        "uq_runs_thread_seq", "runs", ["thread_id", "run_seq"],
        unique=True, postgresql_where=sa.text("run_seq IS NOT NULL"),
    )
    op.create_index(
        "uq_runs_child_parent_tool", "runs",
        ["parent_run_id", "parent_run_message_id", "parent_run_tool_call_id"],
        unique=True, postgresql_where=sa.text("parent_run_id IS NOT NULL"),
    )

    # ------------------------------------------------------------------
    # 5. Recreate run_messages (with thread_id + seq_in_thread)
    # ------------------------------------------------------------------
    op.create_table(
        "run_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.BigInteger, nullable=False),
        sa.Column("seq_in_thread", sa.BigInteger, nullable=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("data", postgresql.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("role IN ('user','assistant','system','tool')", name="ck_run_messages_role"),
        sa.UniqueConstraint("run_id", "seq", name="uq_run_messages_run_seq"),
    )
    op.create_index("ix_run_messages_thread_id", "run_messages", ["thread_id"])
    op.create_index("ix_run_messages_run_id", "run_messages", ["run_id"])
    op.create_index("ix_run_messages_run_created", "run_messages", ["run_id", "created_at"])
    op.create_index("ix_run_messages_thread_seq", "run_messages", ["thread_id", "seq_in_thread"])

    # ------------------------------------------------------------------
    # 6. Recreate run_tool_calls (with thread_id + child_run_id, new status values)
    # ------------------------------------------------------------------
    op.create_table(
        "run_tool_calls",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("run_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("call_seq", sa.Integer, nullable=False),
        sa.Column("llm_call_id", sa.String(255), nullable=False),
        sa.Column("tool_name", sa.String(120), nullable=False),
        sa.Column("arguments", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("result", postgresql.JSONB, nullable=True),
        sa.Column("child_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accepted_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('pending','running','accepted','reject','cancel')",
            name="ck_run_tool_calls_status",
        ),
        sa.UniqueConstraint("message_id", "llm_call_id", name="uq_run_tool_calls_message_llm_call_id"),
        sa.UniqueConstraint("message_id", "call_seq", name="uq_run_tool_calls_message_call_seq"),
    )
    op.create_index("ix_run_tool_calls_thread_id", "run_tool_calls", ["thread_id"])
    op.create_index("ix_run_tool_calls_run_id", "run_tool_calls", ["run_id"])
    op.create_index("ix_run_tool_calls_message", "run_tool_calls", ["message_id"])
    op.create_index("ix_run_tool_calls_status", "run_tool_calls", ["status"])
    op.create_index("ix_run_tool_calls_name", "run_tool_calls", ["tool_name"])


def downgrade() -> None:
    # Not implementing downgrade — destructive early-dev migration
    raise NotImplementedError("Downgrade not supported for destructive migration 0004")

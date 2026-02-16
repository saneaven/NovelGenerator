"""Destructive unified runs v3 migration.

This migration intentionally drops legacy runtime/credentials tables and recreates
run runtime tables around a single `runs` model with 3 run types:
- agent
- subAgent
- journey
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0003_unified_runs_v3"
down_revision = "0002_act_chapter_project_id"
branch_labels = None
depends_on = None


RUN_TYPE_CHECK = (
    "(" 
    "(run_type='agent' AND agent_id IS NOT NULL AND sub_agent_id IS NULL AND journey_kind IS NULL "
    "AND run_mode IS NOT NULL AND surface IS NOT NULL AND parent_run_id IS NULL "
    "AND parent_run_message_id IS NULL AND parent_run_tool_call_id IS NULL) "
    "OR "
    "(run_type='subAgent' AND agent_id IS NOT NULL AND sub_agent_id IS NOT NULL AND journey_kind IS NULL "
    "AND run_mode IS NULL AND surface IS NULL AND parent_run_id IS NOT NULL "
    "AND parent_run_message_id IS NOT NULL AND parent_run_tool_call_id IS NOT NULL) "
    "OR "
    "(run_type='journey' AND agent_id IS NULL AND sub_agent_id IS NULL AND journey_kind IS NOT NULL "
    "AND run_mode IS NULL AND surface IS NULL AND parent_run_id IS NULL "
    "AND parent_run_message_id IS NULL AND parent_run_tool_call_id IS NULL)"
    ")"
)


def _drop_table_if_exists(table_name: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table_name in set(inspector.get_table_names()):
        op.drop_table(table_name)


def upgrade() -> None:
    # Drop in FK-safe order.
    _drop_table_if_exists("run_tool_calls")
    _drop_table_if_exists("run_messages")
    _drop_table_if_exists("agent_runs")
    _drop_table_if_exists("user_credentials")

    # Runs
    op.create_table(
        "runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_type", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("language", sa.String(length=50), nullable=False),
        sa.Column("input_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("final_output", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("sub_agent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("run_mode", sa.String(length=20), nullable=True),
        sa.Column("surface", sa.String(length=40), nullable=True),
        sa.Column("context_object_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("journey_kind", sa.String(length=40), nullable=True),
        sa.Column("journey_target_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("parent_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parent_run_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parent_run_tool_call_id", sa.String(length=255), nullable=True),
        sa.Column("root_run_seq", sa.BigInteger(), nullable=True),
        sa.Column("next_message_seq", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column("frozen_context", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.CheckConstraint("run_type IN ('agent','subAgent','journey')", name="ck_runs_type"),
        sa.CheckConstraint("status IN ('running','waiting','paused','completed','error','cancelled')", name="ck_runs_status"),
        sa.CheckConstraint(RUN_TYPE_CHECK, name="ck_runs_type_fields"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sub_agent_id"], ["sub_agent_definitions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_runs_user_id", "runs", ["user_id"])
    op.create_index("ix_runs_project_id", "runs", ["project_id"])
    op.create_index("ix_runs_agent_id", "runs", ["agent_id"])
    op.create_index("ix_runs_sub_agent_id", "runs", ["sub_agent_id"])
    op.create_index("ix_runs_parent_run_id", "runs", ["parent_run_id"])
    op.create_index("ix_runs_project_status", "runs", ["project_id", "status"])
    op.create_index("ix_runs_type_status", "runs", ["run_type", "status"])
    op.create_index("ix_runs_agent_status", "runs", ["agent_id", "status"])

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_runs_root_seq
        ON runs (agent_id, root_run_seq)
        WHERE run_type='agent' AND root_run_seq IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_runs_child_parent_tool
        ON runs (parent_run_id, parent_run_message_id, parent_run_tool_call_id)
        WHERE run_type='subAgent'
        """
    )

    # Run messages
    op.create_table(
        "run_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.CheckConstraint("role IN ('user','assistant','system','tool')", name="ck_run_messages_role"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "seq", name="uq_run_messages_run_seq"),
    )
    op.create_index("ix_run_messages_run_id", "run_messages", ["run_id"])
    op.create_index("ix_run_messages_run_created", "run_messages", ["run_id", "created_at"])

    # Run tool calls
    op.create_table(
        "run_tool_calls",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("call_seq", sa.Integer(), nullable=False),
        sa.Column("llm_call_id", sa.String(length=255), nullable=False),
        sa.Column("tool_name", sa.String(length=120), nullable=False),
        sa.Column("arguments", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("failure_type", sa.String(length=20), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.CheckConstraint("status IN ('pending','running','accepted','rejected','failed')", name="ck_run_tool_calls_status"),
        sa.CheckConstraint("(failure_type IS NULL) OR (failure_type IN ('validation','execution','partial'))", name="ck_run_tool_calls_failure_type"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["run_messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "llm_call_id", name="uq_run_tool_calls_message_llm_call_id"),
        sa.UniqueConstraint("message_id", "call_seq", name="uq_run_tool_calls_message_call_seq"),
    )
    op.create_index("ix_run_tool_calls_run_id", "run_tool_calls", ["run_id"])
    op.create_index("ix_run_tool_calls_message", "run_tool_calls", ["message_id"])
    op.create_index("ix_run_tool_calls_status", "run_tool_calls", ["status"])
    op.create_index("ix_run_tool_calls_name", "run_tool_calls", ["tool_name"])

    # Server credentials
    op.create_table(
        "server_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("encrypted_config", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "provider", name="uq_server_credentials_user_provider"),
    )
    op.create_index("ix_server_credentials_user_id", "server_credentials", ["user_id"])


def downgrade() -> None:
    _drop_table_if_exists("server_credentials")
    _drop_table_if_exists("run_tool_calls")
    _drop_table_if_exists("run_messages")
    _drop_table_if_exists("runs")

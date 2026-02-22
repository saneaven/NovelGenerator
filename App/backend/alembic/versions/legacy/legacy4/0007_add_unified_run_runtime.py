"""Add unified run runtime tables.

Revision ID: 0007_add_unified_run_runtime
Revises: 0006_rename_invocation_to_run
Create Date: 2026-02-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text
from sqlalchemy.dialects import postgresql


revision = "0007_add_unified_run_runtime"
down_revision = "0006_rename_invocation_to_run"
branch_labels = None
depends_on = None


def _has_index(inspector, table_name: str, index_name: str) -> bool:
    return any(idx.get("name") == index_name for idx in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    # Development-phase hard reset: drop legacy sub-agent runtime tables.
    if "sub_agent_run_messages" in tables:
        op.drop_table("sub_agent_run_messages")
    if "sub_agent_runs" in tables:
        op.drop_table("sub_agent_runs")
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    # agents.next_root_run_seq
    if "agents" in tables:
        cols = {c["name"] for c in inspector.get_columns("agents")}
        if "next_root_run_seq" not in cols:
            op.add_column("agents", sa.Column("next_root_run_seq", sa.BigInteger(), nullable=False, server_default="1"))
            op.alter_column("agents", "next_root_run_seq", server_default=None)

    # agent_runs
    if "agent_runs" not in tables:
        op.create_table(
            "agent_runs",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("run_kind", sa.String(length=16), nullable=False),
            sa.Column("caller", sa.String(length=20), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("language", sa.String(length=50), nullable=False),
            sa.Column("input_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("final_output", sa.Text(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("run_mode", sa.String(length=20), nullable=True),
            sa.Column("surface", sa.String(length=40), nullable=True),
            sa.Column("context_object_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("parent_run_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("parent_run_message_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("parent_run_tool_call_id", sa.String(length=255), nullable=True),
            sa.Column("sub_agent_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("root_run_seq", sa.BigInteger(), nullable=True),
            sa.Column("next_message_seq", sa.BigInteger(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["parent_run_id"], ["agent_runs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["sub_agent_id"], ["sub_agent_definitions.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint("run_kind IN ('root','child')", name="ck_agent_runs_kind"),
            sa.CheckConstraint("caller IN ('planMode','agentMode','subAgent')", name="ck_agent_runs_caller"),
            sa.CheckConstraint("status IN ('running','waiting','paused','completed','error','cancelled')", name="ck_agent_runs_status"),
            sa.CheckConstraint(
                "("
                "(run_kind = 'root' AND parent_run_id IS NULL AND parent_run_message_id IS NULL AND parent_run_tool_call_id IS NULL AND sub_agent_id IS NULL)"
                " OR "
                "(run_kind = 'child' AND parent_run_id IS NOT NULL AND parent_run_message_id IS NOT NULL AND parent_run_tool_call_id IS NOT NULL AND sub_agent_id IS NOT NULL)"
                ")",
                name="ck_agent_runs_parent_fields",
            ),
        )
        op.alter_column("agent_runs", "input_text", server_default=None)
        op.alter_column("agent_runs", "context_object_ids", server_default=None)
        op.alter_column("agent_runs", "next_message_seq", server_default=None)

    # run_messages
    tables = set(inspector.get_table_names())
    if "run_messages" not in tables:
        op.create_table(
            "run_messages",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("seq", sa.BigInteger(), nullable=False),
            sa.Column("role", sa.String(length=16), nullable=False),
            sa.Column("content_parts", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("thinking_details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint("role IN ('user','assistant','system')", name="ck_run_messages_role"),
            sa.UniqueConstraint("run_id", "seq", name="uq_run_messages_run_seq"),
        )
        op.alter_column("run_messages", "content_parts", server_default=None)

    # run_tool_calls
    tables = set(inspector.get_table_names())
    if "run_tool_calls" not in tables:
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
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["message_id"], ["run_messages.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint("status IN ('pending','running','accepted','rejected','failed')", name="ck_run_tool_calls_status"),
            sa.CheckConstraint("(failure_type IS NULL) OR (failure_type IN ('validation','execution','partial'))", name="ck_run_tool_calls_failure_type"),
            sa.UniqueConstraint("message_id", "llm_call_id", name="uq_run_tool_calls_message_llm_call_id"),
            sa.UniqueConstraint("message_id", "call_seq", name="uq_run_tool_calls_message_call_seq"),
        )
        op.alter_column("run_tool_calls", "arguments", server_default=None)

    # indexes
    inspector = inspect(bind)
    if "agent_runs" in set(inspector.get_table_names()):
        bind.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'ck_agent_runs_parent_fields'
                ) THEN
                    ALTER TABLE agent_runs
                    ADD CONSTRAINT ck_agent_runs_parent_fields
                    CHECK (
                        (
                            run_kind = 'root'
                            AND parent_run_id IS NULL
                            AND parent_run_message_id IS NULL
                            AND parent_run_tool_call_id IS NULL
                            AND sub_agent_id IS NULL
                        )
                        OR
                        (
                            run_kind = 'child'
                            AND parent_run_id IS NOT NULL
                            AND parent_run_message_id IS NOT NULL
                            AND parent_run_tool_call_id IS NOT NULL
                            AND sub_agent_id IS NOT NULL
                        )
                    );
                END IF;
            END $$;
        """))
        if not _has_index(inspector, "agent_runs", "ix_agent_runs_agent_status"):
            op.create_index("ix_agent_runs_agent_status", "agent_runs", ["agent_id", "status"])
        if not _has_index(inspector, "agent_runs", "ix_agent_runs_parent"):
            op.create_index("ix_agent_runs_parent", "agent_runs", ["parent_run_id"])
        if not _has_index(inspector, "agent_runs", "ix_agent_runs_root_seq"):
            op.create_index("ix_agent_runs_root_seq", "agent_runs", ["agent_id", "root_run_seq"])
        # partial unique indexes (PostgreSQL)
        bind.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relkind = 'i' AND c.relname = 'uq_agent_runs_root_seq'
                ) THEN
                    CREATE UNIQUE INDEX uq_agent_runs_root_seq
                    ON agent_runs (agent_id, root_run_seq)
                    WHERE run_kind = 'root';
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relkind = 'i' AND c.relname = 'uq_agent_runs_child_parent_tool'
                ) THEN
                    CREATE UNIQUE INDEX uq_agent_runs_child_parent_tool
                    ON agent_runs (parent_run_id, parent_run_message_id, parent_run_tool_call_id)
                    WHERE run_kind = 'child';
                END IF;
            END $$;
        """))

    if "run_messages" in set(inspector.get_table_names()) and not _has_index(inspector, "run_messages", "ix_run_messages_run_created"):
        op.create_index("ix_run_messages_run_created", "run_messages", ["run_id", "created_at"])

    if "run_tool_calls" in set(inspector.get_table_names()):
        if not _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_message"):
            op.create_index("ix_run_tool_calls_message", "run_tool_calls", ["message_id"])
        if not _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_status"):
            op.create_index("ix_run_tool_calls_status", "run_tool_calls", ["status"])
        if not _has_index(inspector, "run_tool_calls", "ix_run_tool_calls_name"):
            op.create_index("ix_run_tool_calls_name", "run_tool_calls", ["tool_name"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "run_tool_calls" in tables:
        op.drop_table("run_tool_calls")
    if "run_messages" in tables:
        op.drop_table("run_messages")
    if "agent_runs" in tables:
        op.drop_table("agent_runs")

    if "agents" in tables:
        cols = {c["name"] for c in inspector.get_columns("agents")}
        if "next_root_run_seq" in cols:
            op.drop_column("agents", "next_root_run_seq")

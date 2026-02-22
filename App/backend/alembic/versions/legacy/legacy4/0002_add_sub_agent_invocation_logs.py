"""Add persistent Sub Agent invocation log tables.

Revision ID: 0002_add_sub_agent_invocation_logs
Revises: 0001_baseline
Create Date: 2026-02-09
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "0002_add_sub_agent_invocation_logs"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "sub_agent_invocations" not in tables:
        op.create_table(
            "sub_agent_invocations",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("parent_type", sa.String(length=20), nullable=False),
            sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("parent_message_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("parent_tool_call_id", sa.String(length=255), nullable=False),
            sa.Column(
                "sub_agent_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("sub_agent_definitions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("agent_name", sa.String(length=50), nullable=False),
            sa.Column("display_name", sa.String(length=200), nullable=False),
            sa.Column("caller", sa.String(length=20), nullable=False),
            sa.Column("language", sa.String(length=50), nullable=False),
            sa.Column("input", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=50), nullable=False),
            sa.Column("final_output", sa.Text(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint(
                "parent_type",
                "parent_id",
                "parent_message_id",
                "parent_tool_call_id",
                name="uq_sub_agent_invocation_parent_tool",
            ),
        )
        op.create_index("ix_sub_agent_invocations_project_id", "sub_agent_invocations", ["project_id"])
        op.create_index("ix_sub_agent_invocations_agent_id", "sub_agent_invocations", ["agent_id"])
        op.create_index("ix_sub_agent_invocations_sub_agent_id", "sub_agent_invocations", ["sub_agent_id"])
        op.create_index(
            "ix_sub_agent_invocations_project_agent_parent_message",
            "sub_agent_invocations",
            ["project_id", "agent_id", "parent_message_id"],
        )
        op.create_index(
            "ix_sub_agent_invocations_parent_ref",
            "sub_agent_invocations",
            ["parent_type", "parent_id", "parent_message_id"],
        )
        op.create_index("ix_sub_agent_invocations_status", "sub_agent_invocations", ["status"])

    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "sub_agent_invocation_messages" not in tables:
        op.create_table(
            "sub_agent_invocation_messages",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column(
                "invocation_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("sub_agent_invocations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("seq", sa.BigInteger(), nullable=False),
            sa.Column("role", sa.String(length=50), nullable=False),
            sa.Column("content_parts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("tool_calls", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("thinking_details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint(
                "invocation_id",
                "seq",
                name="uq_sub_agent_invocation_messages_invocation_seq",
            ),
        )
        op.create_index("ix_sub_agent_invocation_messages_invocation_id", "sub_agent_invocation_messages", ["invocation_id"])
        op.create_index(
            "ix_sub_agent_invocation_messages_invocation_created",
            "sub_agent_invocation_messages",
            ["invocation_id", "created_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "sub_agent_invocation_messages" in tables:
        op.drop_index("ix_sub_agent_invocation_messages_invocation_created", table_name="sub_agent_invocation_messages")
        op.drop_index("ix_sub_agent_invocation_messages_invocation_id", table_name="sub_agent_invocation_messages")
        op.drop_table("sub_agent_invocation_messages")

    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "sub_agent_invocations" in tables:
        op.drop_index("ix_sub_agent_invocations_status", table_name="sub_agent_invocations")
        op.drop_index("ix_sub_agent_invocations_parent_ref", table_name="sub_agent_invocations")
        op.drop_index("ix_sub_agent_invocations_project_agent_parent_message", table_name="sub_agent_invocations")
        op.drop_index("ix_sub_agent_invocations_sub_agent_id", table_name="sub_agent_invocations")
        op.drop_index("ix_sub_agent_invocations_agent_id", table_name="sub_agent_invocations")
        op.drop_index("ix_sub_agent_invocations_project_id", table_name="sub_agent_invocations")
        op.drop_table("sub_agent_invocations")


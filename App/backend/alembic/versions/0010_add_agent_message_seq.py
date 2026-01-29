"""Add per-agent message sequence ordering.

Revision ID: 0010_add_agent_message_seq
Revises: 0009_add_task_token_limits_to_task_configs
Create Date: 2026-01-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "0010_add_agent_message_seq"
down_revision = "0009_add_task_token_limits_to_task_configs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    agent_cols = {col["name"] for col in inspector.get_columns("agents")}
    if "next_message_seq" not in agent_cols:
        op.add_column(
            "agents",
            sa.Column("next_message_seq", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        )
        op.alter_column("agents", "next_message_seq", server_default=None)

    # Reset agent chat tables (you plan to wipe data and start over).
    # `agent_messages` is referenced by agent-memory tables, so drop and recreate the whole set.
    if "agent_messages" in tables:
        if "agent_rag_chunks" in tables:
            op.drop_table("agent_rag_chunks")
        if "agent_rag_sources" in tables:
            op.drop_table("agent_rag_sources")
        if "agent_memory_summaries" in tables:
            op.drop_table("agent_memory_summaries")
        op.drop_table("agent_messages")

        # Reset per-agent counters/boundaries as well.
        op.execute("UPDATE agents SET archived_until_message_id = NULL")
        op.execute("UPDATE agents SET next_message_seq = 1")

        # Refresh inspector state after destructive changes.
        inspector = inspect(bind)
        tables = set(inspector.get_table_names())

    if "agent_messages" not in tables:
        op.create_table(
            "agent_messages",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("agent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("seq", sa.BigInteger(), nullable=False),
            sa.Column("role", sa.String(length=50), nullable=False),
            sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("tool_calls", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("agent_id", "seq", name="uq_agent_messages_agent_id_seq"),
        )
        op.create_index("ix_agent_messages_agent_id", "agent_messages", ["agent_id"])
        op.create_index("ix_agent_messages_created_at", "agent_messages", ["created_at"])

    # Recreate agent-memory tables if missing (they may have been dropped above).
    tables = set(inspector.get_table_names())
    if "agent_memory_summaries" not in tables:
        op.create_table(
            "agent_memory_summaries",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("language", sa.String(length=50), nullable=False),
            sa.Column("to_message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False),
            sa.Column("summary_text", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        )
        op.create_index("ix_agent_memory_summaries_user_id", "agent_memory_summaries", ["user_id"])
        op.create_index("ix_agent_memory_summaries_project_id", "agent_memory_summaries", ["project_id"])
        op.create_index("ix_agent_memory_summaries_agent_id", "agent_memory_summaries", ["agent_id"])
        op.create_index("ix_agent_memory_summaries_created_at", "agent_memory_summaries", ["created_at"])
        op.create_index(
            "ix_agent_memory_summaries_agent_to_message",
            "agent_memory_summaries",
            ["agent_id", "to_message_id"],
        )

    tables = set(inspector.get_table_names())
    if "agent_rag_sources" not in tables:
        op.create_table(
            "agent_rag_sources",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False),
            sa.Column("language", sa.String(length=50), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=True),
            sa.Column("content_hash", sa.String(length=64), nullable=True),
            sa.Column("index_state", sa.String(length=40), nullable=False, server_default=sa.text("'ready'")),
            sa.Column("indexed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("user_id", "agent_id", "message_id", "language", name="uq_agent_rag_source_identity"),
        )
        op.create_index("ix_agent_rag_sources_user_id", "agent_rag_sources", ["user_id"])
        op.create_index("ix_agent_rag_sources_project_id", "agent_rag_sources", ["project_id"])
        op.create_index("ix_agent_rag_sources_agent_id", "agent_rag_sources", ["agent_id"])
        op.create_index("ix_agent_rag_sources_agent_language", "agent_rag_sources", ["agent_id", "language"])

    tables = set(inspector.get_table_names())
    if "agent_rag_chunks" not in tables:
        op.create_table(
            "agent_rag_chunks",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("source_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_rag_sources.id", ondelete="CASCADE"), nullable=False),
            sa.Column("chunk_index", sa.Integer(), nullable=False),
            sa.Column("field_path", sa.Text(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("embedding", sa.Text(), nullable=False),  # stored as pgvector 'vector'
            sa.Column("embedding_dim", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("source_id", "chunk_index", name="uq_agent_rag_chunk_index"),
        )
        op.create_index("ix_agent_rag_chunks_source_id", "agent_rag_chunks", ["source_id"])
        op.execute("ALTER TABLE agent_rag_chunks ALTER COLUMN embedding TYPE vector USING embedding::vector")

    # Unique constraint is created when `agent_messages` is (re)created above.


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    existing_uqs = {uc["name"] for uc in inspector.get_unique_constraints("agent_messages")}
    if "uq_agent_messages_agent_id_seq" in existing_uqs:
        op.drop_constraint("uq_agent_messages_agent_id_seq", "agent_messages", type_="unique")

    msg_cols = {col["name"] for col in inspector.get_columns("agent_messages")}
    if "seq" in msg_cols:
        op.drop_column("agent_messages", "seq")

    agent_cols = {col["name"] for col in inspector.get_columns("agents")}
    if "next_message_seq" in agent_cols:
        op.drop_column("agents", "next_message_seq")

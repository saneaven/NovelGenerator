"""Add agent long-term memory tables and boundary cache.

Revision ID: 0005_add_agent_long_term_memory
Revises: 0004_add_tool_call_auto_approve
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "0005_add_agent_long_term_memory"
down_revision = "0004_add_tool_call_auto_approve"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # ---------------------------------------------------------------------
    # agents.archived_until_message_id (UI divider + idempotency boundary)
    # ---------------------------------------------------------------------
    agent_cols = {col["name"] for col in inspector.get_columns("agents")}
    if "archived_until_message_id" not in agent_cols:
        op.add_column(
            "agents",
            sa.Column("archived_until_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_index(
            "ix_agents_archived_until_message_id",
            "agents",
            ["archived_until_message_id"],
        )

    # ---------------------------------------------------------------------
    # agent_memory_summaries
    # ---------------------------------------------------------------------
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

    # ---------------------------------------------------------------------
    # agent_rag_sources / agent_rag_chunks
    # ---------------------------------------------------------------------
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

    if "agent_rag_chunks" not in tables:
        # pgvector type is created by baseline (CREATE EXTENSION vector)
        op.create_table(
            "agent_rag_chunks",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("source_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_rag_sources.id", ondelete="CASCADE"), nullable=False),
            sa.Column("chunk_index", sa.Integer(), nullable=False),
            sa.Column("field_path", sa.Text(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("embedding", sa.Text(), nullable=False),  # stored as pgvector 'vector' (see rag_models.Vector)
            sa.Column("embedding_dim", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("source_id", "chunk_index", name="uq_agent_rag_chunk_index"),
        )
        op.create_index("ix_agent_rag_chunks_source_id", "agent_rag_chunks", ["source_id"])

        # Convert embedding column to pgvector `vector` (keep migration self-contained)
        op.execute("ALTER TABLE agent_rag_chunks ALTER COLUMN embedding TYPE vector USING embedding::vector")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "agent_rag_chunks" in tables:
        op.drop_index("ix_agent_rag_chunks_source_id", table_name="agent_rag_chunks")
        op.drop_table("agent_rag_chunks")

    if "agent_rag_sources" in tables:
        op.drop_index("ix_agent_rag_sources_agent_language", table_name="agent_rag_sources")
        op.drop_index("ix_agent_rag_sources_agent_id", table_name="agent_rag_sources")
        op.drop_index("ix_agent_rag_sources_project_id", table_name="agent_rag_sources")
        op.drop_index("ix_agent_rag_sources_user_id", table_name="agent_rag_sources")
        op.drop_table("agent_rag_sources")

    if "agent_memory_summaries" in tables:
        op.drop_index("ix_agent_memory_summaries_agent_to_message", table_name="agent_memory_summaries")
        op.drop_index("ix_agent_memory_summaries_created_at", table_name="agent_memory_summaries")
        op.drop_index("ix_agent_memory_summaries_agent_id", table_name="agent_memory_summaries")
        op.drop_index("ix_agent_memory_summaries_project_id", table_name="agent_memory_summaries")
        op.drop_index("ix_agent_memory_summaries_user_id", table_name="agent_memory_summaries")
        op.drop_table("agent_memory_summaries")

    agent_cols = {col["name"] for col in inspector.get_columns("agents")}
    if "archived_until_message_id" in agent_cols:
        op.drop_index("ix_agents_archived_until_message_id", table_name="agents")
        op.drop_column("agents", "archived_until_message_id")


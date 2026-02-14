"""Rename agent memory tables to generic message memory tables.

- agent_memory_summaries → message_memory_summaries
- agent_rag_sources → message_rag_sources
- agent_rag_chunks → message_rag_chunks
- agent_id column → owner_id (drop FK constraint)

Revision ID: 0002
Revises: 0001
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- agent_rag_chunks → message_rag_chunks ---
    # Drop FK from chunks to sources first
    op.drop_constraint("agent_rag_chunks_source_id_fkey", "agent_rag_chunks", type_="foreignkey")
    op.drop_constraint("uq_agent_rag_chunk_index", "agent_rag_chunks", type_="unique")
    op.drop_index("ix_agent_rag_chunks_source_id", table_name="agent_rag_chunks")
    op.rename_table("agent_rag_chunks", "message_rag_chunks")
    op.create_index("ix_message_rag_chunks_source_id", "message_rag_chunks", ["source_id"])
    op.create_unique_constraint("uq_message_rag_chunk_index", "message_rag_chunks", ["source_id", "chunk_index"])

    # --- agent_rag_sources → message_rag_sources ---
    # Drop FKs and constraints
    op.drop_constraint("uq_agent_rag_source_identity", "agent_rag_sources", type_="unique")
    op.drop_index("ix_agent_rag_sources_agent_language", table_name="agent_rag_sources")
    op.drop_index("ix_agent_rag_sources_agent_id", table_name="agent_rag_sources")
    op.drop_constraint("agent_rag_sources_agent_id_fkey", "agent_rag_sources", type_="foreignkey")
    op.drop_constraint("agent_rag_sources_user_id_fkey", "agent_rag_sources", type_="foreignkey")
    op.drop_constraint("agent_rag_sources_project_id_fkey", "agent_rag_sources", type_="foreignkey")
    op.drop_constraint("agent_rag_sources_message_id_fkey", "agent_rag_sources", type_="foreignkey")
    # Rename column
    op.alter_column("agent_rag_sources", "agent_id", new_column_name="owner_id")
    op.rename_table("agent_rag_sources", "message_rag_sources")
    # Recreate indexes/constraints (no FK on owner_id)
    op.create_index("ix_message_rag_sources_user_id", "message_rag_sources", ["user_id"])
    op.create_index("ix_message_rag_sources_project_id", "message_rag_sources", ["project_id"])
    op.create_index("ix_message_rag_sources_owner_id", "message_rag_sources", ["owner_id"])
    op.create_unique_constraint("uq_message_rag_source_identity", "message_rag_sources", ["user_id", "owner_id", "message_id", "language"])
    op.create_index("ix_message_rag_sources_owner_language", "message_rag_sources", ["owner_id", "language"])

    # Re-add FK from chunks to sources (now renamed)
    op.create_foreign_key(
        "message_rag_chunks_source_id_fkey",
        "message_rag_chunks", "message_rag_sources",
        ["source_id"], ["id"],
        ondelete="CASCADE",
    )

    # --- agent_memory_summaries → message_memory_summaries ---
    op.drop_index("ix_agent_memory_summaries_agent_to_message", table_name="agent_memory_summaries")
    op.drop_index("ix_agent_memory_summaries_agent_id", table_name="agent_memory_summaries")
    op.drop_constraint("agent_memory_summaries_agent_id_fkey", "agent_memory_summaries", type_="foreignkey")
    op.drop_constraint("agent_memory_summaries_user_id_fkey", "agent_memory_summaries", type_="foreignkey")
    op.drop_constraint("agent_memory_summaries_project_id_fkey", "agent_memory_summaries", type_="foreignkey")
    op.drop_constraint("agent_memory_summaries_to_message_id_fkey", "agent_memory_summaries", type_="foreignkey")
    # Rename column
    op.alter_column("agent_memory_summaries", "agent_id", new_column_name="owner_id")
    op.rename_table("agent_memory_summaries", "message_memory_summaries")
    # Recreate indexes (no FK on owner_id)
    op.create_index("ix_message_memory_summaries_user_id", "message_memory_summaries", ["user_id"])
    op.create_index("ix_message_memory_summaries_project_id", "message_memory_summaries", ["project_id"])
    op.create_index("ix_message_memory_summaries_owner_id", "message_memory_summaries", ["owner_id"])
    op.create_index("ix_message_memory_summaries_owner_to_message", "message_memory_summaries", ["owner_id", "to_message_id"])


def downgrade() -> None:
    # --- message_memory_summaries → agent_memory_summaries ---
    op.drop_index("ix_message_memory_summaries_owner_to_message", table_name="message_memory_summaries")
    op.drop_index("ix_message_memory_summaries_owner_id", table_name="message_memory_summaries")
    op.drop_index("ix_message_memory_summaries_project_id", table_name="message_memory_summaries")
    op.drop_index("ix_message_memory_summaries_user_id", table_name="message_memory_summaries")
    op.rename_table("message_memory_summaries", "agent_memory_summaries")
    op.alter_column("agent_memory_summaries", "owner_id", new_column_name="agent_id")
    op.create_foreign_key("agent_memory_summaries_agent_id_fkey", "agent_memory_summaries", "agents", ["agent_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("agent_memory_summaries_user_id_fkey", "agent_memory_summaries", "users", ["user_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("agent_memory_summaries_project_id_fkey", "agent_memory_summaries", "projects", ["project_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("agent_memory_summaries_to_message_id_fkey", "agent_memory_summaries", "run_messages", ["to_message_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_agent_memory_summaries_agent_id", "agent_memory_summaries", ["agent_id"])
    op.create_index("ix_agent_memory_summaries_agent_to_message", "agent_memory_summaries", ["agent_id", "to_message_id"])

    # --- message_rag_chunks → agent_rag_chunks ---
    op.drop_constraint("message_rag_chunks_source_id_fkey", "message_rag_chunks", type_="foreignkey")
    op.drop_unique_constraint("uq_message_rag_chunk_index", "message_rag_chunks")
    op.drop_index("ix_message_rag_chunks_source_id", table_name="message_rag_chunks")
    op.rename_table("message_rag_chunks", "agent_rag_chunks")
    op.create_index("ix_agent_rag_chunks_source_id", "agent_rag_chunks", ["source_id"])
    op.create_unique_constraint("uq_agent_rag_chunk_index", "agent_rag_chunks", ["source_id", "chunk_index"])

    # --- message_rag_sources → agent_rag_sources ---
    op.drop_unique_constraint("uq_message_rag_source_identity", "message_rag_sources")
    op.drop_index("ix_message_rag_sources_owner_language", table_name="message_rag_sources")
    op.drop_index("ix_message_rag_sources_owner_id", table_name="message_rag_sources")
    op.drop_index("ix_message_rag_sources_project_id", table_name="message_rag_sources")
    op.drop_index("ix_message_rag_sources_user_id", table_name="message_rag_sources")
    op.rename_table("message_rag_sources", "agent_rag_sources")
    op.alter_column("agent_rag_sources", "owner_id", new_column_name="agent_id")
    op.create_foreign_key("agent_rag_sources_agent_id_fkey", "agent_rag_sources", "agents", ["agent_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("agent_rag_sources_user_id_fkey", "agent_rag_sources", "users", ["user_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("agent_rag_sources_project_id_fkey", "agent_rag_sources", "projects", ["project_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("agent_rag_sources_message_id_fkey", "agent_rag_sources", "run_messages", ["message_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_agent_rag_sources_agent_id", "agent_rag_sources", ["agent_id"])
    op.create_unique_constraint("uq_agent_rag_source_identity", "agent_rag_sources", ["user_id", "agent_id", "message_id", "language"])
    op.create_index("ix_agent_rag_sources_agent_language", "agent_rag_sources", ["agent_id", "language"])

    # Re-add FK from chunks to sources
    op.create_foreign_key(
        "agent_rag_chunks_source_id_fkey",
        "agent_rag_chunks", "agent_rag_sources",
        ["source_id"], ["id"],
        ondelete="CASCADE",
    )

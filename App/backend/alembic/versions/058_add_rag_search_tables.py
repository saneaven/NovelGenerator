"""add_rag_search_tables

Revision ID: 058
Revises: 057
Create Date: 2026-01-25

Add minimal tables for RAG search:
- rag_embedding_profiles (user-level active embedding config)
- rag_sources (per project/object indexing metadata + ordering metadata)
- rag_chunks (chunk text + embedding vector)

Notes:
- This app is in early development; we keep schema minimal and do not preserve legacy vectors
  across embedding model changes.
- We create pgvector extension and store embeddings as `vector` (no ANN index in MVP).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid


revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pgvector
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "rag_embedding_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    op.create_table(
        "rag_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("object_type", sa.String(length=50), nullable=False),
        sa.Column("object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("language", sa.String(length=50), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("index_state", sa.String(length=40), nullable=False, server_default="ready"),
        sa.Column("indexed_at", sa.DateTime, nullable=True),
        # Ordering metadata (deterministic result ordering)
        sa.Column("type_group", sa.String(length=30), nullable=False),
        sa.Column("story_object_type", sa.String(length=50), nullable=True),
        sa.Column("story_object_order", sa.Integer(), nullable=True),
        sa.Column("outline_order", sa.Integer(), nullable=True),
        sa.Column("act_order", sa.Integer(), nullable=True),
        sa.Column("chapter_order", sa.Integer(), nullable=True),
        sa.Column("chapter_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "project_id", "object_type", "object_id", "language", name="uq_rag_source_identity"),
        sa.Index("ix_rag_sources_project_group_order", "project_id", "type_group", "outline_order", "act_order", "chapter_order", "story_object_order"),
    )

    # rag_chunks uses pgvector `vector` type; define with raw SQL to avoid alembic type plumbing.
    op.execute(
        """
        CREATE TABLE rag_chunks (
            id uuid PRIMARY KEY,
            source_id uuid NOT NULL REFERENCES rag_sources(id) ON DELETE CASCADE,
            chunk_index integer NOT NULL,
            field_path text NOT NULL,
            text text NOT NULL,
            embedding vector NOT NULL,
            embedding_dim integer NOT NULL,
            created_at timestamp NOT NULL DEFAULT now(),
            UNIQUE (source_id, chunk_index)
        )
        """
    )

    op.execute("CREATE INDEX ix_rag_chunks_source_id ON rag_chunks (source_id)")
    op.execute("CREATE INDEX ix_rag_chunks_source_chunk ON rag_chunks (source_id, chunk_index)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS rag_chunks")
    op.drop_table("rag_sources")
    op.drop_table("rag_embedding_profiles")

"""Add RAG Search tuning fields to user_settings.

Revision ID: 0003_add_rag_search_defaults
Revises: 0002_add_rag_search_enabled
Create Date: 2026-01-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_add_rag_search_defaults"
down_revision = "0002_add_rag_search_enabled"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("rag_search_top_k_per_query", sa.Integer(), nullable=False, server_default=sa.text("20")),
    )
    op.add_column(
        "user_settings",
        sa.Column("rag_search_neighbor_window", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "user_settings",
        sa.Column("rag_search_max_primary_chunks", sa.Integer(), nullable=False, server_default=sa.text("20")),
    )
    op.add_column(
        "user_settings",
        sa.Column("rag_search_max_total_chunks", sa.Integer(), nullable=False, server_default=sa.text("60")),
    )

    op.alter_column("user_settings", "rag_search_top_k_per_query", server_default=None)
    op.alter_column("user_settings", "rag_search_neighbor_window", server_default=None)
    op.alter_column("user_settings", "rag_search_max_primary_chunks", server_default=None)
    op.alter_column("user_settings", "rag_search_max_total_chunks", server_default=None)


def downgrade() -> None:
    op.drop_column("user_settings", "rag_search_max_total_chunks")
    op.drop_column("user_settings", "rag_search_max_primary_chunks")
    op.drop_column("user_settings", "rag_search_neighbor_window")
    op.drop_column("user_settings", "rag_search_top_k_per_query")


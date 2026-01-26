"""Add RAG Search tuning fields to user_settings.

Revision ID: 0003_add_rag_search_defaults
Revises: 0002_add_rag_search_enabled
Create Date: 2026-01-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0003_add_rag_search_defaults"
down_revision = "0002_add_rag_search_enabled"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "rag_search_top_k_per_query" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("rag_search_top_k_per_query", sa.Integer(), nullable=False, server_default=sa.text("20")),
        )
        op.alter_column("user_settings", "rag_search_top_k_per_query", server_default=None)

    if "rag_search_neighbor_window" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("rag_search_neighbor_window", sa.Integer(), nullable=False, server_default=sa.text("0")),
        )
        op.alter_column("user_settings", "rag_search_neighbor_window", server_default=None)

    if "rag_search_max_primary_chunks" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("rag_search_max_primary_chunks", sa.Integer(), nullable=False, server_default=sa.text("20")),
        )
        op.alter_column("user_settings", "rag_search_max_primary_chunks", server_default=None)

    if "rag_search_max_total_chunks" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("rag_search_max_total_chunks", sa.Integer(), nullable=False, server_default=sa.text("60")),
        )
        op.alter_column("user_settings", "rag_search_max_total_chunks", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "rag_search_max_total_chunks" in existing:
        op.drop_column("user_settings", "rag_search_max_total_chunks")
    if "rag_search_max_primary_chunks" in existing:
        op.drop_column("user_settings", "rag_search_max_primary_chunks")
    if "rag_search_neighbor_window" in existing:
        op.drop_column("user_settings", "rag_search_neighbor_window")
    if "rag_search_top_k_per_query" in existing:
        op.drop_column("user_settings", "rag_search_top_k_per_query")

"""Rename rag_search_enabled to vector_storage_enabled."""

from __future__ import annotations

from alembic import op


revision = "0003_vector_storage_enabled"
down_revision = "0002_demo_mode_enabled"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("user_settings", "rag_search_enabled", new_column_name="vector_storage_enabled")


def downgrade() -> None:
    op.alter_column("user_settings", "vector_storage_enabled", new_column_name="rag_search_enabled")

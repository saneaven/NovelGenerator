"""Add rag_search_enabled flag to user_settings.

Revision ID: 0002_add_rag_search_enabled
Revises: 0001_baseline
Create Date: 2026-01-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0002_add_rag_search_enabled"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "rag_search_enabled" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("rag_search_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
        op.alter_column("user_settings", "rag_search_enabled", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "rag_search_enabled" in existing:
        op.drop_column("user_settings", "rag_search_enabled")

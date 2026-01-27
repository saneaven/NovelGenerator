"""Add Agent Memory search defaults to user_settings.

Revision ID: 0007_add_agent_memory_search_defaults
Revises: 0006_move_embedding_profiles_to_user_settings
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0007_add_agent_memory_search_defaults"
down_revision = "0006_move_embedding_profiles_to_user_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "agent_memory_top_k_per_query" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("agent_memory_top_k_per_query", sa.Integer(), nullable=False, server_default=sa.text("20")),
        )
        op.alter_column("user_settings", "agent_memory_top_k_per_query", server_default=None)

    if "agent_memory_neighbor_window" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("agent_memory_neighbor_window", sa.Integer(), nullable=False, server_default=sa.text("0")),
        )
        op.alter_column("user_settings", "agent_memory_neighbor_window", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "agent_memory_neighbor_window" in existing:
        op.drop_column("user_settings", "agent_memory_neighbor_window")

    if "agent_memory_top_k_per_query" in existing:
        op.drop_column("user_settings", "agent_memory_top_k_per_query")


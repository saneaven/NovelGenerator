"""Add Agent Memory max message limits to user_settings.

Revision ID: 0008_add_agent_memory_max_message_limits
Revises: 0007_add_agent_memory_search_defaults
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0008_add_agent_memory_max_message_limits"
down_revision = "0007_add_agent_memory_search_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "agent_memory_max_primary_messages" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("agent_memory_max_primary_messages", sa.Integer(), nullable=False, server_default=sa.text("20")),
        )
        op.alter_column("user_settings", "agent_memory_max_primary_messages", server_default=None)

    if "agent_memory_max_total_messages" not in existing:
        op.add_column(
            "user_settings",
            sa.Column("agent_memory_max_total_messages", sa.Integer(), nullable=False, server_default=sa.text("60")),
        )
        op.alter_column("user_settings", "agent_memory_max_total_messages", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "agent_memory_max_total_messages" in existing:
        op.drop_column("user_settings", "agent_memory_max_total_messages")

    if "agent_memory_max_primary_messages" in existing:
        op.drop_column("user_settings", "agent_memory_max_primary_messages")


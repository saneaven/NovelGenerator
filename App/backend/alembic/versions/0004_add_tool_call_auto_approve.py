"""Add tool_call_auto_approve to user_settings.

Revision ID: 0004_add_tool_call_auto_approve
Revises: 0003_add_rag_search_defaults
Create Date: 2026-01-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "0004_add_tool_call_auto_approve"
down_revision = "0003_add_rag_search_defaults"
branch_labels = None
depends_on = None


DEFAULT_TOOL_CALL_AUTO_APPROVE = (
    '{"create": false, "delete": false, "patch": false, "replace": false, "read": false, "search": false}'
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "tool_call_auto_approve" not in existing:
        op.add_column(
            "user_settings",
            sa.Column(
                "tool_call_auto_approve",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text(f"'{DEFAULT_TOOL_CALL_AUTO_APPROVE}'::jsonb"),
            ),
        )
        op.alter_column("user_settings", "tool_call_auto_approve", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("user_settings")}

    if "tool_call_auto_approve" in existing:
        op.drop_column("user_settings", "tool_call_auto_approve")

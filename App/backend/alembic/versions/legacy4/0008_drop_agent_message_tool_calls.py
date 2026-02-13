"""Drop agent_messages.tool_calls column.

Revision ID: 0008_drop_agent_message_tool_calls
Revises: 0007_add_unified_run_runtime
Create Date: 2026-02-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "0008_drop_agent_message_tool_calls"
down_revision = "0007_add_unified_run_runtime"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "agent_messages" not in set(inspector.get_table_names()):
        return

    cols = {c["name"] for c in inspector.get_columns("agent_messages")}
    if "tool_calls" in cols:
        op.drop_column("agent_messages", "tool_calls")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "agent_messages" not in set(inspector.get_table_names()):
        return

    cols = {c["name"] for c in inspector.get_columns("agent_messages")}
    if "tool_calls" not in cols:
        op.add_column(
            "agent_messages",
            sa.Column("tool_calls", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        )

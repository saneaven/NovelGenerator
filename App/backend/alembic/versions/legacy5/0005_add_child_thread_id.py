"""Add child_thread_id column to run_tool_calls.

Allows frontend to look up the child thread directly from a tool call
without needing the child_run_id → run → thread_id lookup chain.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0005_add_child_thread_id"
down_revision = "0004_add_threads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "run_tool_calls",
        sa.Column(
            "child_thread_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("threads.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("run_tool_calls", "child_thread_id")

"""Normalize run_tool_calls status values and split thread history snapshot fields."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0006_normalize_tool_status_and_split_history_snapshot"
down_revision = "0005_add_child_thread_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Normalize existing status values.
    op.execute("UPDATE run_tool_calls SET status = 'rejected' WHERE status = 'reject'")
    op.execute("UPDATE run_tool_calls SET status = 'cancelled' WHERE status = 'cancel'")

    # Replace status constraint.
    op.execute("ALTER TABLE run_tool_calls DROP CONSTRAINT IF EXISTS ck_run_tool_calls_status")
    op.create_check_constraint(
        "ck_run_tool_calls_status",
        "run_tool_calls",
        "status IN ('pending','running','accepted','rejected','cancelled')",
    )

    # Split thread history snapshot storage.
    op.add_column("threads", sa.Column("captured_history_system_prompt", sa.Text(), nullable=True))
    op.add_column(
        "threads",
        sa.Column("captured_history_conversation_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("threads", sa.Column("captured_history_prefill", sa.Text(), nullable=True))

    op.execute(
        """
        UPDATE threads
        SET
            captured_history_system_prompt = '',
            captured_history_conversation_json = captured_history_json,
            captured_history_prefill = ''
        """
    )

    op.drop_column("threads", "captured_history_json")


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for breaking migration 0006")

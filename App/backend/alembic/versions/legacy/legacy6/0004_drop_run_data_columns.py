"""Drop input_text, input_payload, final_output from runs; drop captured_from_run_id from threads.

RunModel is now metadata-only. User input text is stored in RunMessageModel.data.
Rendered conversations are captured/reused via Thread JSONB fields.

Revision ID: 0004_drop_run_data_columns
Revises: 0003_tool_call_cascade
Create Date: 2026-02-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0004_drop_run_data_columns"
down_revision = "0003_tool_call_cascade"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("runs", "input_text")
    op.drop_column("runs", "input_payload")
    op.drop_column("runs", "final_output")
    op.drop_column("threads", "captured_from_run_id")


def downgrade() -> None:
    op.add_column("threads", sa.Column("captured_from_run_id", postgresql.UUID(), nullable=True))
    op.add_column("runs", sa.Column("final_output", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("input_payload", postgresql.JSONB(), server_default="{}", nullable=False))
    op.add_column("runs", sa.Column("input_text", sa.Text(), server_default="", nullable=False))

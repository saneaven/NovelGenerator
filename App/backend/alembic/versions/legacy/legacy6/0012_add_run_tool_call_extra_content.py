"""Add extra_content column to run_tool_calls.

Revision ID: 0012_add_run_tool_call_extra_content
Revises: 0011_delete_cover_image_prompts
Create Date: 2026-02-21
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0012_add_run_tool_call_extra_content"
down_revision = "0011_delete_cover_image_prompts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Alembic default schema can keep version_num at VARCHAR(32).
    # This project uses descriptive revision IDs, so widen once to prevent
    # future upgrade failures from revision-id truncation.
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)")

    op.add_column(
        "run_tool_calls",
        sa.Column("extra_content", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("run_tool_calls", "extra_content")

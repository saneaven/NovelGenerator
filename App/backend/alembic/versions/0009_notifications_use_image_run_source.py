"""Rename notification source imageTask -> imageRun.

Revision ID: 0009_notifications_use_image_run_source
Revises: 0008_add_image_runs
Create Date: 2026-03-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0009_notifications_use_image_run_source"
down_revision = "0008_add_image_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_notifications_source", "notifications", type_="check")
    op.execute("UPDATE notifications SET source = 'imageRun' WHERE source = 'imageTask'")
    op.create_check_constraint(
        "ck_notifications_source",
        "notifications",
        "source IN ('journey','imageRun')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_notifications_source", "notifications", type_="check")
    op.execute("UPDATE notifications SET source = 'imageTask' WHERE source = 'imageRun'")
    op.create_check_constraint(
        "ck_notifications_source",
        "notifications",
        "source IN ('journey','imageTask')",
    )

"""Add reconcile metadata to project storage usage aggregates.

Revision ID: 0011_storage_usage_reconcile_metadata
Revises: 0010_total_project_storage_usage
Create Date: 2026-03-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0011_storage_usage_reconcile_metadata"
down_revision = "0010_total_project_storage_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_storage_usage",
        sa.Column("needs_reconcile", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "project_storage_usage",
        sa.Column("last_reconciled_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_project_storage_usage_needs_reconcile",
        "project_storage_usage",
        ["needs_reconcile"],
        unique=False,
    )
    op.create_index(
        "ix_project_storage_usage_last_reconciled_at",
        "project_storage_usage",
        ["last_reconciled_at"],
        unique=False,
    )

    op.execute(
        sa.text(
            """
            UPDATE project_storage_usage
            SET needs_reconcile = false,
                last_reconciled_at = COALESCE(updated_at, NOW())
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_project_storage_usage_last_reconciled_at", table_name="project_storage_usage")
    op.drop_index("ix_project_storage_usage_needs_reconcile", table_name="project_storage_usage")
    op.drop_column("project_storage_usage", "last_reconciled_at")
    op.drop_column("project_storage_usage", "needs_reconcile")

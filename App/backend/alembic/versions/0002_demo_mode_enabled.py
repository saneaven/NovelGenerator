"""Add demo mode toggle to user settings."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_demo_mode_enabled"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("demo_mode_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("user_settings", "demo_mode_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("user_settings", "demo_mode_enabled")

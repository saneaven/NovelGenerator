"""Add custom_thinking_templates JSONB column to user_settings.

Revision ID: 0013
Revises: 0012
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("custom_thinking_templates", JSONB, nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "custom_thinking_templates")

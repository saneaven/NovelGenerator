"""Add retry_config to user_settings

Revision ID: 011
Revises: 010
Create Date: 2025-11-29

Adds retry_config JSONB column to user_settings table
for storing retry configuration (enabled, maxRetries, retryableStatusCodes, retryDelayMs)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add retry_config JSONB column with default value
    op.add_column(
        'user_settings',
        sa.Column(
            'retry_config',
            postgresql.JSONB,
            nullable=True,
            server_default=sa.text(
                "'{\"enabled\": true, \"maxRetries\": 3, \"retryableStatusCodes\": [429, 500, 502, 503, 504], \"retryDelayMs\": 1000}'::jsonb"
            )
        )
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'retry_config')

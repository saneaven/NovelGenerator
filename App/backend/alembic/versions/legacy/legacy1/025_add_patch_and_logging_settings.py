"""add_patch_and_logging_settings

Revision ID: 025
Revises: 024
Create Date: 2025-12-16

Add patch_auto_retry and llm_logging_enabled columns to user_settings table.
- patch_auto_retry: Automatically retry with replace mode if patch fails (default: true)
- llm_logging_enabled: Enable LLM request logging for debugging (default: false)
"""
from alembic import op
import sqlalchemy as sa

revision = '025'
down_revision = '024'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'user_settings',
        sa.Column('patch_auto_retry', sa.Boolean, nullable=False, server_default='true')
    )
    op.add_column(
        'user_settings',
        sa.Column('llm_logging_enabled', sa.Boolean, nullable=False, server_default='false')
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'llm_logging_enabled')
    op.drop_column('user_settings', 'patch_auto_retry')

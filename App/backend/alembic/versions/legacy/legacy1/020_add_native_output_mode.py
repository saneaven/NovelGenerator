"""add_native_output_mode

Revision ID: 020
Revises: 019
Create Date: 2025-12-02

Add native_output_mode column to user_settings table.
This setting toggles between function calling mode and native LLM output mode.
"""
from alembic import op
import sqlalchemy as sa

revision = '020'
down_revision = '019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'user_settings',
        sa.Column('native_output_mode', sa.Boolean, nullable=False, server_default='false')
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'native_output_mode')

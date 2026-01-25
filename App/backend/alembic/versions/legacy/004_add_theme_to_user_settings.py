"""add_theme_to_user_settings

Revision ID: 004
Revises: 003
Create Date: 2025-10-22

Add theme column to user_settings table for light/dark/system theme preference.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add theme column to user_settings table.
    """
    op.add_column(
        'user_settings',
        sa.Column('theme', sa.String(20), nullable=False, server_default='system')
    )


def downgrade() -> None:
    """
    Remove theme column from user_settings table.
    """
    op.drop_column('user_settings', 'theme')

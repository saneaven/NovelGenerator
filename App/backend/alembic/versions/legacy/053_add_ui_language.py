"""add_ui_language

Revision ID: 053
Revises: 052
Create Date: 2026-01-19

Add ui_language column to user_settings table for interface localization (i18next).
- ui_language: Language code for UI localization (default: 'en')
"""
from alembic import op
import sqlalchemy as sa

revision = '053'
down_revision = '052'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add ui_language column
    op.add_column(
        'user_settings',
        sa.Column('ui_language', sa.String(10), nullable=False, server_default='en')
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'ui_language')

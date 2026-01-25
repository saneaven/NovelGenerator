"""add_function_call_history_settings

Revision ID: 035
Revises: 034
Create Date: 2025-12-30

Add function_call_history_limit and display_language columns to user_settings table.
- function_call_history_limit: Number of recent assistant messages to include function calls for (default: 5)
- display_language: UI display language (default: 'English')
"""
from alembic import op
import sqlalchemy as sa

revision = '035'
down_revision = '034'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add function_call_history_limit column
    op.add_column(
        'user_settings',
        sa.Column('function_call_history_limit', sa.Integer, nullable=False, server_default='5')
    )

    # Add display_language column
    op.add_column(
        'user_settings',
        sa.Column('display_language', sa.String(50), nullable=False, server_default='English')
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'function_call_history_limit')
    op.drop_column('user_settings', 'display_language')

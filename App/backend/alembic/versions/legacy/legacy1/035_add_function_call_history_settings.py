"""add_function_call_history_settings

Revision ID: 035
Revises: 034
Create Date: 2025-12-30

Add function_call_history_limit column to user_settings table.
- function_call_history_limit: Number of recent assistant messages to include function calls for (default: 5)
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


def downgrade() -> None:
    op.drop_column('user_settings', 'function_call_history_limit')

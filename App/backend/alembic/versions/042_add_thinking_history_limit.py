"""add_thinking_history_limit

Revision ID: 042
Revises: 041
Create Date: 2026-01-16

Add thinking_history_limit column to user_settings table.
- thinking_history_limit: Number of recent assistant messages to include thinking for (default: 5)
"""
from alembic import op
import sqlalchemy as sa

revision = '042'
down_revision = '041'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add thinking_history_limit column
    op.add_column(
        'user_settings',
        sa.Column('thinking_history_limit', sa.Integer, nullable=False, server_default='5')
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'thinking_history_limit')

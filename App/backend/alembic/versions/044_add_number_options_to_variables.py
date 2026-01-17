"""add_number_options_to_variables

Revision ID: 044
Revises: 043
Create Date: 2026-01-16

Add number_options column to prompt_variables table for storing
min, max, step, and input_type settings for number type variables.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '044'
down_revision = '043'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add number_options column to prompt_variables table.
    """
    op.add_column(
        'prompt_variables',
        sa.Column('number_options', postgresql.JSONB, nullable=True)
    )


def downgrade() -> None:
    """
    Remove number_options column from prompt_variables table.
    """
    op.drop_column('prompt_variables', 'number_options')

"""create_prompt_variables_table

Revision ID: 043
Revises: 042
Create Date: 2026-01-16

Create prompt_variables table for user-defined prompt template variables.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = '043'
down_revision = '042'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Create prompt_variables table for storing user-defined prompt variables.
    """

    # Create prompt_variables table
    op.create_table(
        'prompt_variables',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),

        # Variable identification
        sa.Column('name', sa.String(100), nullable=False),

        # Variable type: 'string', 'number', 'boolean', 'select'
        sa.Column('var_type', sa.String(20), nullable=False),

        # Value storage as JSONB: {"value": <actual value>}
        sa.Column('value', postgresql.JSONB, nullable=False, server_default='{"value": null}'),

        # Select options (only used when var_type='select')
        sa.Column('select_options', postgresql.JSONB, nullable=True),

        # Description for UI display
        sa.Column('description', sa.Text, nullable=True),

        # Display order
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),

        # Timestamps
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Create index for user_id
    op.create_index(
        'idx_variable_user_id',
        'prompt_variables',
        ['user_id']
    )

    # Create unique constraint for user_id + name
    op.create_unique_constraint(
        'uq_variable_user_name',
        'prompt_variables',
        ['user_id', 'name']
    )

    # Create index for ordering
    op.create_index(
        'idx_variable_user_order',
        'prompt_variables',
        ['user_id', 'display_order']
    )


def downgrade() -> None:
    """
    Drop prompt_variables table.
    """

    # Drop indexes and constraints
    op.drop_index('idx_variable_user_order', 'prompt_variables')
    op.drop_constraint('uq_variable_user_name', 'prompt_variables', type_='unique')
    op.drop_index('idx_variable_user_id', 'prompt_variables')

    # Drop table
    op.drop_table('prompt_variables')

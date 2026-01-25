"""create_prompt_versions_table

Revision ID: 003
Revises: 002
Create Date: 2025-10-21

Create prompt_versions table for version-controlled user-editable prompts.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Create prompt_versions table for storing version-controlled prompts.
    """

    # Create prompt_versions table
    op.create_table(
        'prompt_versions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),

        # Prompt identification
        sa.Column('function_type', sa.String(50), nullable=False),
        sa.Column('prompt_category', sa.String(50), nullable=False),
        sa.Column('prompt_name', sa.String(50), nullable=True),

        # Version data
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('version_number', sa.Integer, nullable=False),
        sa.Column('is_active', sa.Boolean, default=False, nullable=False),
        sa.Column('is_default', sa.Boolean, default=False, nullable=False),

        # Metadata
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('note', sa.Text, nullable=True),
    )

    # Create indexes for performance
    op.create_index(
        'idx_prompt_user_function',
        'prompt_versions',
        ['user_id', 'function_type', 'prompt_category', 'prompt_name']
    )

    op.create_index(
        'idx_prompt_active',
        'prompt_versions',
        ['user_id', 'is_active']
    )

    # Create unique constraint for version numbers per prompt
    op.create_index(
        'idx_prompt_unique_version',
        'prompt_versions',
        ['user_id', 'function_type', 'prompt_category', 'prompt_name', 'version_number'],
        unique=True
    )


def downgrade() -> None:
    """
    Drop prompt_versions table.
    """

    # Drop indexes
    op.drop_index('idx_prompt_unique_version', 'prompt_versions')
    op.drop_index('idx_prompt_active', 'prompt_versions')
    op.drop_index('idx_prompt_user_function', 'prompt_versions')

    # Drop table
    op.drop_table('prompt_versions')

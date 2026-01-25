"""Remove is_active column from prompt_versions and prompt_fragments

The version control system now uses the highest version_number as the active version.
The is_active column is no longer needed.

Revision ID: 045
Revises: 044
Create Date: 2024-01-17
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '045'
down_revision = '044'
branch_labels = None
depends_on = None


def upgrade():
    # Drop is_active column from prompt_versions
    op.drop_column('prompt_versions', 'is_active')

    # Drop is_active column from prompt_fragments
    op.drop_column('prompt_fragments', 'is_active')


def downgrade():
    # Add is_active column back to prompt_versions
    op.add_column(
        'prompt_versions',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='false')
    )

    # Add is_active column back to prompt_fragments
    op.add_column(
        'prompt_fragments',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='false')
    )

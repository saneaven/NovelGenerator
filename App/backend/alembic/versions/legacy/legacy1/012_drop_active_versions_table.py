"""Drop active_versions table

The active_versions table is no longer needed.
The new version control system always uses the highest version_number as the active version.

Revision ID: 012
Revises: 011
Create Date: 2024-01-01
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '012'
down_revision = '011'
branch_labels = None
depends_on = None


def upgrade():
    # Drop the active_versions table
    op.drop_table('active_versions')


def downgrade():
    # Recreate the active_versions table if needed
    op.create_table(
        'active_versions',
        sa.Column('object_type', sa.String(50), primary_key=True),
        sa.Column('object_id', sa.UUID(), primary_key=True),
        sa.Column('active_version_id', sa.UUID(), sa.ForeignKey('object_versions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_active_versions_version_id', 'active_versions', ['active_version_id'])
    
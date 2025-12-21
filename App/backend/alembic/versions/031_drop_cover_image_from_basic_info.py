"""drop_cover_image_from_basic_info

Revision ID: 031
Revises: 030
Create Date: 2025-12-20

Removes cover_image_id column from basic_info table.
Cover images are now managed via StoryObjectAsset junction table.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '031'
down_revision = '030'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop foreign key constraint first
    op.drop_constraint('fk_basic_info_cover_image', 'basic_info', type_='foreignkey')

    # Drop the column
    op.drop_column('basic_info', 'cover_image_id')


def downgrade() -> None:
    # Add the column back
    op.add_column(
        'basic_info',
        sa.Column('cover_image_id', postgresql.UUID(as_uuid=True), nullable=True)
    )

    # Add foreign key constraint back
    op.create_foreign_key(
        'fk_basic_info_cover_image',
        'basic_info',
        'assets',
        ['cover_image_id'],
        ['id'],
        ondelete='SET NULL'
    )

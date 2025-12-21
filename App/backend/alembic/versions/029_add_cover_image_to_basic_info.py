"""add_cover_image_to_basic_info

Revision ID: 029
Revises: 028
Create Date: 2025-12-19

Adds cover_image_id column to basic_info table:
- Nullable foreign key to assets table
- SET NULL on delete (removing asset doesn't delete basic_info)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '029'
down_revision = '028'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add cover_image_id column to basic_info table
    op.add_column(
        'basic_info',
        sa.Column('cover_image_id', postgresql.UUID(as_uuid=True), nullable=True)
    )

    # Add foreign key constraint
    op.create_foreign_key(
        'fk_basic_info_cover_image',
        'basic_info',
        'assets',
        ['cover_image_id'],
        ['id'],
        ondelete='SET NULL'
    )


def downgrade() -> None:
    # Drop foreign key constraint
    op.drop_constraint('fk_basic_info_cover_image', 'basic_info', type_='foreignkey')

    # Drop column
    op.drop_column('basic_info', 'cover_image_id')

"""add_asset_type_and_chapter_assets

Revision ID: 022
Revises: 021
Create Date: 2025-12-05

Changes:
1. Add asset_type column to assets table ('scene' | 'object' | null)
2. Create chapter_assets table for tracking scene asset usage in chapters
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = '022'
down_revision = '021'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ========================================================================
    # 1. Add asset_type column to assets table
    # ========================================================================
    op.add_column(
        'assets',
        sa.Column('asset_type', sa.String(20), nullable=True)
    )
    op.create_index('ix_assets_asset_type', 'assets', ['asset_type'])

    # ========================================================================
    # 2. Create chapter_assets table
    # ========================================================================
    op.create_table(
        'chapter_assets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('chapter_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('chapters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('asset_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('assets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )

    op.create_index('ix_chapter_assets_chapter_id', 'chapter_assets', ['chapter_id'])
    op.create_index('ix_chapter_assets_asset_id', 'chapter_assets', ['asset_id'])
    op.create_index('idx_chapter_asset', 'chapter_assets', ['chapter_id', 'asset_id'], unique=True)


def downgrade() -> None:
    # Drop chapter_assets table
    op.drop_index('idx_chapter_asset', 'chapter_assets')
    op.drop_index('ix_chapter_assets_asset_id', 'chapter_assets')
    op.drop_index('ix_chapter_assets_chapter_id', 'chapter_assets')
    op.drop_table('chapter_assets')

    # Remove asset_type column from assets
    op.drop_index('ix_assets_asset_type', 'assets')
    op.drop_column('assets', 'asset_type')

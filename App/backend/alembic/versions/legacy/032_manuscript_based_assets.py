"""manuscript_based_assets

Revision ID: 032
Revises: 031
Create Date: 2025-12-28

Changes:
1. Add manuscript_id column to assets table (ownership for scene assets)
2. Rename chapter_assets table to manuscript_usages
3. Convert chapter_id to manuscript_id in manuscript_usages
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '032'
down_revision = '031'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ========================================================================
    # 1. Add manuscript_id to assets table (ownership for scene assets)
    # ========================================================================
    op.add_column(
        'assets',
        sa.Column('manuscript_id', postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_index('ix_assets_manuscript_id', 'assets', ['manuscript_id'])
    op.create_foreign_key(
        'fk_assets_manuscript',
        'assets', 'manuscripts',
        ['manuscript_id'], ['id'],
        ondelete='SET NULL'
    )

    # ========================================================================
    # 2. Rename chapter_assets table to manuscript_asset_usages
    # ========================================================================
    # Drop existing indexes first
    op.drop_index('idx_chapter_asset', 'chapter_assets')
    op.drop_index('ix_chapter_assets_asset_id', 'chapter_assets')
    op.drop_index('ix_chapter_assets_chapter_id', 'chapter_assets')

    # Rename table
    op.rename_table('chapter_assets', 'manuscript_asset_usages')

    # ========================================================================
    # 3. Add manuscript_id column to manuscript_asset_usages
    # ========================================================================
    op.add_column(
        'manuscript_asset_usages',
        sa.Column('manuscript_id', postgresql.UUID(as_uuid=True), nullable=True)
    )

    # ========================================================================
    # 4. Migrate data: chapter_id → manuscript_id
    # ========================================================================
    op.execute('''
        UPDATE manuscript_asset_usages mau
        SET manuscript_id = m.id
        FROM manuscripts m
        WHERE m.chapter_id = mau.chapter_id
    ''')

    # ========================================================================
    # 5. Make manuscript_id NOT NULL and add FK
    # ========================================================================
    op.alter_column('manuscript_asset_usages', 'manuscript_id', nullable=False)
    op.create_foreign_key(
        'fk_manuscript_asset_usages_manuscript',
        'manuscript_asset_usages', 'manuscripts',
        ['manuscript_id'], ['id'],
        ondelete='CASCADE'
    )

    # ========================================================================
    # 6. Drop chapter_id column and old FK
    # ========================================================================
    # Drop old foreign key constraint first
    op.drop_constraint('chapter_assets_chapter_id_fkey', 'manuscript_asset_usages', type_='foreignkey')
    op.drop_column('manuscript_asset_usages', 'chapter_id')

    # ========================================================================
    # 7. Create new indexes
    # ========================================================================
    op.create_index('ix_manuscript_asset_usages_manuscript_id', 'manuscript_asset_usages', ['manuscript_id'])
    op.create_index('ix_manuscript_asset_usages_asset_id', 'manuscript_asset_usages', ['asset_id'])
    op.create_index('idx_manuscript_asset_usage', 'manuscript_asset_usages', ['manuscript_id', 'asset_id'], unique=True)


def downgrade() -> None:
    # ========================================================================
    # Reverse: Convert back to chapter_assets with chapter_id
    # ========================================================================
    # Drop new indexes
    op.drop_index('idx_manuscript_asset_usage', 'manuscript_asset_usages')
    op.drop_index('ix_manuscript_asset_usages_asset_id', 'manuscript_asset_usages')
    op.drop_index('ix_manuscript_asset_usages_manuscript_id', 'manuscript_asset_usages')

    # Add chapter_id column back
    op.add_column(
        'manuscript_asset_usages',
        sa.Column('chapter_id', postgresql.UUID(as_uuid=True), nullable=True)
    )

    # Migrate data back: manuscript_id → chapter_id
    op.execute('''
        UPDATE manuscript_asset_usages mau
        SET chapter_id = m.chapter_id
        FROM manuscripts m
        WHERE m.id = mau.manuscript_id
    ''')

    op.alter_column('manuscript_asset_usages', 'chapter_id', nullable=False)
    op.create_foreign_key(
        'chapter_assets_chapter_id_fkey',
        'manuscript_asset_usages', 'chapters',
        ['chapter_id'], ['id'],
        ondelete='CASCADE'
    )

    # Drop manuscript_id column and FK
    op.drop_constraint('fk_manuscript_asset_usages_manuscript', 'manuscript_asset_usages', type_='foreignkey')
    op.drop_column('manuscript_asset_usages', 'manuscript_id')

    # Rename table back
    op.rename_table('manuscript_asset_usages', 'chapter_assets')

    # Recreate old indexes
    op.create_index('ix_chapter_assets_chapter_id', 'chapter_assets', ['chapter_id'])
    op.create_index('ix_chapter_assets_asset_id', 'chapter_assets', ['asset_id'])
    op.create_index('idx_chapter_asset', 'chapter_assets', ['chapter_id', 'asset_id'], unique=True)

    # Remove manuscript_id from assets
    op.drop_constraint('fk_assets_manuscript', 'assets', type_='foreignkey')
    op.drop_index('ix_assets_manuscript_id', 'assets')
    op.drop_column('assets', 'manuscript_id')

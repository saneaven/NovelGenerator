"""add_asset_tables

Revision ID: 013
Revises: 012
Create Date: 2025-12-01

Creates asset management tables:
1. assets - Stores image files (uploaded or generated)
2. story_object_assets - Links assets to characters/locations
3. manuscript_images - Images embedded in manuscript content
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = '013'
down_revision = '012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ========================================================================
    # 1. ASSETS - Main asset storage
    # ========================================================================
    op.create_table(
        'assets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),

        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('thumbnail_path', sa.String(500), nullable=True),
        sa.Column('mime_type', sa.String(50), nullable=False, server_default='image/png'),

        # Generation metadata
        sa.Column('generation_prompt', sa.Text, nullable=True),
        sa.Column('generation_provider', sa.String(50), nullable=True),
        sa.Column('generation_model', sa.String(100), nullable=True),

        # Image dimensions
        sa.Column('width', sa.Integer, nullable=True),
        sa.Column('height', sa.Integer, nullable=True),
        sa.Column('file_size', sa.Integer, nullable=True),

        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
    )

    op.create_index('ix_assets_project_id', 'assets', ['project_id'])

    # ========================================================================
    # 2. STORY_OBJECT_ASSETS - Links assets to story objects
    # ========================================================================
    op.create_table(
        'story_object_assets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),

        sa.Column('object_type', sa.String(50), nullable=False),
        sa.Column('object_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('asset_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('assets.id', ondelete='CASCADE'), nullable=False),

        sa.Column('is_main', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),

        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )

    op.create_index('ix_story_object_assets_object_id', 'story_object_assets', ['object_id'])
    op.create_index('ix_story_object_assets_asset_id', 'story_object_assets', ['asset_id'])
    op.create_index('idx_story_object_asset', 'story_object_assets', ['object_type', 'object_id'])

    # ========================================================================
    # 3. MANUSCRIPT_IMAGES - Images embedded in manuscript
    # ========================================================================
    op.create_table(
        'manuscript_images',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('manuscript_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('manuscripts.id', ondelete='CASCADE'), nullable=False),

        sa.Column('position', sa.Integer, nullable=False),

        sa.Column('source_type', sa.String(20), nullable=False),  # 'asset' or 'story_object'
        sa.Column('asset_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('assets.id', ondelete='SET NULL'), nullable=True),

        sa.Column('story_object_type', sa.String(50), nullable=True),
        sa.Column('story_object_id', postgresql.UUID(as_uuid=True), nullable=True),

        sa.Column('generation_prompt', sa.Text, nullable=True),
        sa.Column('display_width', sa.Integer, nullable=False, server_default='400'),
        sa.Column('caption', sa.Text, nullable=True),

        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
    )

    op.create_index('ix_manuscript_images_manuscript_id', 'manuscript_images', ['manuscript_id'])


def downgrade() -> None:
    op.drop_index('ix_manuscript_images_manuscript_id', 'manuscript_images')
    op.drop_table('manuscript_images')

    op.drop_index('idx_story_object_asset', 'story_object_assets')
    op.drop_index('ix_story_object_assets_asset_id', 'story_object_assets')
    op.drop_index('ix_story_object_assets_object_id', 'story_object_assets')
    op.drop_table('story_object_assets')

    op.drop_index('ix_assets_project_id', 'assets')
    op.drop_table('assets')

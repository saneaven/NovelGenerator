"""multilingual_redesign

Revision ID: 006
Revises: 005
Create Date: 2025-11-08

Ground-up redesign of the multilingual translation system.
Creates three-layer architecture:
1. Core objects (structure only - modified in later migration)
2. Translation cache (object_translations - fast queries)
3. Version history (object_versions - single source of truth)

This migration creates the new tables alongside existing ones.
Data migration happens in a separate script.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

# revision identifiers, used by Alembic.
revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Create new multilingual system tables.
    """

    # ========================================================================
    # 1. OBJECT_TRANSLATIONS - Translation Cache (Layer 2)
    # ========================================================================
    op.create_table(
        'object_translations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),

        # Object identification
        sa.Column('object_type', sa.String(50), nullable=False),
        sa.Column('object_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Language
        sa.Column('language', sa.String(50), nullable=False),

        # Translation data (flexible JSONB)
        sa.Column('data', postgresql.JSONB, nullable=False),

        # Active language flag
        sa.Column('is_active', sa.Boolean, default=False, nullable=False),

        # Timestamps
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Unique constraint: one translation per object per language
    op.create_index(
        'uq_object_language',
        'object_translations',
        ['object_type', 'object_id', 'language'],
        unique=True
    )

    # GIN index for fast JSONB queries
    op.execute(
        'CREATE INDEX ix_object_translations_data ON object_translations USING gin (data)'
    )

    # Regular indexes for common queries
    op.create_index(
        'ix_object_translations_type',
        'object_translations',
        ['object_type']
    )

    op.create_index(
        'ix_object_translations_object_id',
        'object_translations',
        ['object_id']
    )

    op.create_index(
        'ix_object_translations_language',
        'object_translations',
        ['language']
    )

    op.create_index(
        'ix_object_translations_is_active',
        'object_translations',
        ['is_active']
    )

    # Composite indexes for complex queries
    op.create_index(
        'ix_object_translations_type_id_lang',
        'object_translations',
        ['object_type', 'object_id', 'language']
    )

    op.create_index(
        'ix_object_translations_type_active',
        'object_translations',
        ['object_type', 'is_active']
    )

    # ========================================================================
    # 2. OBJECT_VERSIONS - Version History (Layer 3 - Source of Truth)
    # ========================================================================
    op.create_table(
        'object_versions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),

        # Object identification
        sa.Column('object_type', sa.String(50), nullable=False),
        sa.Column('object_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Version number (sequential, 1-indexed)
        sa.Column('version_number', sa.Integer, nullable=False),

        # Multilingual data (ALL languages)
        sa.Column('data', postgresql.JSONB, nullable=False),

        # Metadata
        sa.Column('user_request', sa.Text, nullable=True),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )

    # Unique constraint: unique version numbers per object
    op.create_index(
        'uq_object_version_number',
        'object_versions',
        ['object_type', 'object_id', 'version_number'],
        unique=True
    )

    # Indexes for version queries
    op.create_index(
        'ix_object_versions_type_id_num',
        'object_versions',
        ['object_type', 'object_id', 'version_number']
    )

    op.create_index(
        'ix_object_versions_type',
        'object_versions',
        ['object_type']
    )

    op.create_index(
        'ix_object_versions_object_id',
        'object_versions',
        ['object_id']
    )

    op.create_index(
        'ix_object_versions_created_at',
        'object_versions',
        ['created_at']
    )

    op.create_index(
        'ix_object_versions_created_by',
        'object_versions',
        ['created_by']
    )

    # GIN index for querying version data
    op.execute(
        'CREATE INDEX ix_object_versions_data ON object_versions USING gin (data)'
    )

    # ========================================================================
    # 3. ACTIVE_VERSIONS - Version Pointers
    # ========================================================================
    op.create_table(
        'active_versions',
        # Composite primary key
        sa.Column('object_type', sa.String(50), primary_key=True),
        sa.Column('object_id', postgresql.UUID(as_uuid=True), primary_key=True),

        # Pointer to active version
        sa.Column('active_version_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('object_versions.id', ondelete='CASCADE'), nullable=False),

        # Timestamp
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
    )

    # Index on version pointer for joins
    op.create_index(
        'ix_active_versions_version_id',
        'active_versions',
        ['active_version_id']
    )


def downgrade() -> None:
    """
    Drop all new tables.
    WARNING: This will delete all version data!
    """

    # Drop active_versions
    op.drop_index('ix_active_versions_version_id', 'active_versions')
    op.drop_table('active_versions')

    # Drop object_versions
    op.execute('DROP INDEX IF EXISTS ix_object_versions_data')
    op.drop_index('ix_object_versions_created_by', 'object_versions')
    op.drop_index('ix_object_versions_created_at', 'object_versions')
    op.drop_index('ix_object_versions_object_id', 'object_versions')
    op.drop_index('ix_object_versions_type', 'object_versions')
    op.drop_index('ix_object_versions_type_id_num', 'object_versions')
    op.drop_index('uq_object_version_number', 'object_versions')
    op.drop_table('object_versions')

    # Drop object_translations
    op.drop_index('ix_object_translations_type_active', 'object_translations')
    op.drop_index('ix_object_translations_type_id_lang', 'object_translations')
    op.drop_index('ix_object_translations_is_active', 'object_translations')
    op.drop_index('ix_object_translations_language', 'object_translations')
    op.drop_index('ix_object_translations_object_id', 'object_translations')
    op.drop_index('ix_object_translations_type', 'object_translations')
    op.execute('DROP INDEX IF EXISTS ix_object_translations_data')
    op.drop_index('uq_object_language', 'object_translations')
    op.drop_table('object_translations')

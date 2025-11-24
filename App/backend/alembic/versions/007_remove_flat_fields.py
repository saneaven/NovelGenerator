"""remove_flat_fields

Revision ID: 007
Revises: 006
Create Date: 2025-11-08

Remove all flat content fields from story object tables.
After this migration, ALL content comes from the new translation system.

Run this AFTER data migration and validation.

Tables modified:
- basic_info: Drop title, logline, genre, active_version_id
- characters: Drop name, description, active_version_id
- organizations: Drop name, description, active_version_id
- locations: Drop name, description, active_version_id
- lorebook_entries: Drop name, description, active_version_id
- acts: Drop name, description, active_version_id (keep order)
- chapters: Drop name, description, active_version_id (keep order)
- outlines: Drop active_version_id
- chapter_contents: Drop active_version_id
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Remove flat fields from all story object tables.
    Content now comes exclusively from object_translations.
    """

    print("\n⚠ WARNING: This migration removes all flat content fields!")
    print("Ensure data migration is complete and validated before running.\n")

    # ========================================================================
    # 1. BASIC_INFO
    # ========================================================================
    print("Removing flat fields from basic_info...")

    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)

    def column_exists(table: str, column: str) -> bool:
        return any(col['name'] == column for col in inspector.get_columns(table))

    def drop_if_exists(table: str, column: str):
        if column_exists(table, column):
            op.drop_column(table, column)

    drop_if_exists('basic_info', 'title')
    drop_if_exists('basic_info', 'logline')
    drop_if_exists('basic_info', 'genre')
    drop_if_exists('basic_info', 'active_version_id')

    # Drop versions relationship (viewonly, so just cleanup comment)
    # The actual relationship is defined in Python, not in DB

    # ========================================================================
    # 2. CHARACTERS
    # ========================================================================
    print("Removing flat fields from characters...")

    drop_if_exists('characters', 'name')
    drop_if_exists('characters', 'description')
    drop_if_exists('characters', 'active_version_id')

    # ========================================================================
    # 3. ORGANIZATIONS
    # ========================================================================
    print("Removing flat fields from organizations...")

    drop_if_exists('organizations', 'name')
    drop_if_exists('organizations', 'description')
    drop_if_exists('organizations', 'active_version_id')

    # ========================================================================
    # 4. LOCATIONS
    # ========================================================================
    print("Removing flat fields from locations...")

    drop_if_exists('locations', 'name')
    drop_if_exists('locations', 'description')
    drop_if_exists('locations', 'active_version_id')

    # ========================================================================
    # 5. LOREBOOK_ENTRIES
    # ========================================================================
    print("Removing flat fields from lorebook_entries...")

    drop_if_exists('lorebook_entries', 'name')
    drop_if_exists('lorebook_entries', 'description')
    drop_if_exists('lorebook_entries', 'active_version_id')

    # ========================================================================
    # 6. ACTS (keep order - it's structural)
    # ========================================================================
    print("Removing flat fields from acts...")

    drop_if_exists('acts', 'name')
    drop_if_exists('acts', 'description')
    drop_if_exists('acts', 'active_version_id')
    # Keep: id, outline_id, order, created_at, updated_at

    # ========================================================================
    # 7. CHAPTERS (keep order - it's structural)
    # ========================================================================
    print("Removing flat fields from chapters...")

    drop_if_exists('chapters', 'name')
    drop_if_exists('chapters', 'description')
    drop_if_exists('chapters', 'active_version_id')
    # Keep: id, act_id, order, created_at, updated_at

    # ========================================================================
    # 8. OUTLINES
    # ========================================================================
    print("Removing active_version_id from outlines...")

    drop_if_exists('outlines', 'active_version_id')

    # ========================================================================
    # 9. CHAPTER_CONTENTS
    # ========================================================================
    print("Removing active_version_id from chapter_contents...")

    drop_if_exists('chapter_contents', 'active_version_id')

    print("\n✓ All flat fields removed!")
    print("Core tables now contain only structure (IDs, relationships, timestamps).\n")


def downgrade() -> None:
    """
    Re-add flat fields to all tables.
    WARNING: This will create empty columns - no data restoration!
    """

    print("\n⚠ WARNING: Downgrade will create empty flat fields!")
    print("Original data is NOT restored - it remains in new system.\n")

    # Re-add columns (they will be NULL/empty)

    # chapter_contents
    op.add_column('chapter_contents',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))

    # outlines
    op.add_column('outlines',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))

    # chapters
    op.add_column('chapters',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('chapters',
                  sa.Column('description', sa.Text, nullable=True))
    op.add_column('chapters',
                  sa.Column('name', sa.String(255), nullable=True))

    # acts
    op.add_column('acts',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('acts',
                  sa.Column('description', sa.Text, nullable=True))
    op.add_column('acts',
                  sa.Column('name', sa.String(255), nullable=True))

    # lorebook_entries
    op.add_column('lorebook_entries',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('lorebook_entries',
                  sa.Column('description', sa.Text, nullable=True))
    op.add_column('lorebook_entries',
                  sa.Column('name', sa.String(255), nullable=True))

    # locations
    op.add_column('locations',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('locations',
                  sa.Column('description', sa.Text, nullable=True))
    op.add_column('locations',
                  sa.Column('name', sa.String(255), nullable=True))

    # organizations
    op.add_column('organizations',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('organizations',
                  sa.Column('description', sa.Text, nullable=True))
    op.add_column('organizations',
                  sa.Column('name', sa.String(255), nullable=True))

    # characters
    op.add_column('characters',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('characters',
                  sa.Column('description', sa.Text, nullable=True))
    op.add_column('characters',
                  sa.Column('name', sa.String(255), nullable=True))

    # basic_info
    op.add_column('basic_info',
                  sa.Column('active_version_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('basic_info',
                  sa.Column('genre', sa.String(100), nullable=True))
    op.add_column('basic_info',
                  sa.Column('logline', sa.Text, nullable=True))
    op.add_column('basic_info',
                  sa.Column('title', sa.String(500), nullable=True))

    print("\n✓ Flat fields re-added (but empty!)\n")

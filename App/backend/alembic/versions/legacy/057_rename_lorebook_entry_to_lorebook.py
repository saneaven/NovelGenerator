"""rename_lorebook_entry_to_lorebook

Revision ID: 057
Revises: 056
Create Date: 2026-01-23

Rename object_type 'lorebook_entry' to 'lorebook' in all tables.
This removes the inconsistency where the frontend uses 'lorebook' but the database stored 'lorebook_entry'.
"""
from alembic import op
import sqlalchemy as sa

revision = '057'
down_revision = '056'
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    # Update object_versions table
    connection.execute(sa.text("""
        UPDATE object_versions
        SET object_type = 'lorebook'
        WHERE object_type = 'lorebook_entry'
    """))

    # Update story_object_assets table
    connection.execute(sa.text("""
        UPDATE story_object_assets
        SET object_type = 'lorebook'
        WHERE object_type = 'lorebook_entry'
    """))


def downgrade() -> None:
    connection = op.get_bind()

    # Revert object_versions table
    connection.execute(sa.text("""
        UPDATE object_versions
        SET object_type = 'lorebook_entry'
        WHERE object_type = 'lorebook'
    """))

    # Revert story_object_assets table
    connection.execute(sa.text("""
        UPDATE story_object_assets
        SET object_type = 'lorebook_entry'
        WHERE object_type = 'lorebook'
    """))

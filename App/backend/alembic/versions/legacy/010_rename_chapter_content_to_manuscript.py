"""Rename chapter_content to manuscript

Revision ID: 010
Revises: 009
Create Date: 2025-11-28

Renames:
- Table: chapter_contents -> manuscripts
- Table: chapter_content_versions -> manuscript_versions
- Column: chapter_content_id -> manuscript_id
- object_type values: 'chapter_content' -> 'manuscript' in all relevant tables
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Step 1: Rename tables
    op.rename_table('chapter_contents', 'manuscripts')
    op.rename_table('chapter_content_versions', 'manuscript_versions')

    # Step 2: Rename column in manuscript_versions
    op.alter_column('manuscript_versions', 'chapter_content_id',
                    new_column_name='manuscript_id')

    # Step 3: Update object_type values in translation system tables
    conn.execute(sa.text("""
        UPDATE object_translations
        SET object_type = 'manuscript'
        WHERE object_type = 'chapter_content'
    """))

    conn.execute(sa.text("""
        UPDATE object_versions
        SET object_type = 'manuscript'
        WHERE object_type = 'chapter_content'
    """))

    conn.execute(sa.text("""
        UPDATE active_versions
        SET object_type = 'manuscript'
        WHERE object_type = 'chapter_content'
    """))

    # Step 4: Update story_object_versions if it has chapter_content type
    conn.execute(sa.text("""
        UPDATE story_object_versions
        SET object_type = 'manuscript'
        WHERE object_type = 'chapter_content'
    """))


def downgrade() -> None:
    conn = op.get_bind()

    # Step 1: Revert object_type values
    conn.execute(sa.text("""
        UPDATE object_translations
        SET object_type = 'chapter_content'
        WHERE object_type = 'manuscript'
    """))

    conn.execute(sa.text("""
        UPDATE object_versions
        SET object_type = 'chapter_content'
        WHERE object_type = 'manuscript'
    """))

    conn.execute(sa.text("""
        UPDATE active_versions
        SET object_type = 'chapter_content'
        WHERE object_type = 'manuscript'
    """))

    conn.execute(sa.text("""
        UPDATE story_object_versions
        SET object_type = 'chapter_content'
        WHERE object_type = 'manuscript'
    """))

    # Step 2: Rename column back
    op.alter_column('manuscript_versions', 'manuscript_id',
                    new_column_name='chapter_content_id')

    # Step 3: Rename tables back
    op.rename_table('manuscript_versions', 'chapter_content_versions')
    op.rename_table('manuscripts', 'chapter_contents')

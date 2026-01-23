"""add_content_field_to_story_objects

Revision ID: 055
Revises: 054
Create Date: 2026-01-22

Migrate story object data structure from {name, description} to {name, description, content}:
- Existing 'description' field moves to 'content'
- New 'description' field is empty string (for one-line summaries)

Affected object types: character, organization, location, lorebook, outline, act, chapter
"""

from alembic import op
import sqlalchemy as sa

revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None

# Object types that need migration
STORY_OBJECT_TYPES = ['character', 'organization', 'location', 'lorebook', 'outline', 'act', 'chapter']


def upgrade() -> None:
    """
    Migrate data structure:
    Before: {"English": {"name": "X", "description": "Y"}}
    After:  {"English": {"name": "X", "description": "", "content": "Y"}}
    """
    connection = op.get_bind()

    # Build the object_type filter for the WHERE clause
    types_filter = "', '".join(STORY_OBJECT_TYPES)

    # Update JSONB data: move 'description' to 'content', set 'description' to empty string
    # This uses PostgreSQL JSONB functions to transform each language's data
    connection.execute(sa.text(f"""
        UPDATE object_versions
        SET data = (
            SELECT jsonb_object_agg(
                lang_key,
                CASE
                    WHEN lang_data ? 'description' THEN
                        jsonb_set(
                            jsonb_set(lang_data, '{{content}}', COALESCE(lang_data->'description', '""')),
                            '{{description}}',
                            '""'
                        )
                    ELSE
                        lang_data || '{{"description": "", "content": ""}}'::jsonb
                END
            )
            FROM jsonb_each(data) AS x(lang_key, lang_data)
        )
        WHERE object_type IN ('{types_filter}')
    """))


def downgrade() -> None:
    """
    Revert data structure:
    Before: {"English": {"name": "X", "description": "", "content": "Y"}}
    After:  {"English": {"name": "X", "description": "Y"}}
    """
    connection = op.get_bind()

    types_filter = "', '".join(STORY_OBJECT_TYPES)

    # Move 'content' back to 'description', remove 'content' field
    connection.execute(sa.text(f"""
        UPDATE object_versions
        SET data = (
            SELECT jsonb_object_agg(
                lang_key,
                (lang_data - 'content') || jsonb_build_object('description', COALESCE(lang_data->>'content', ''))
            )
            FROM jsonb_each(data) AS x(lang_key, lang_data)
        )
        WHERE object_type IN ('{types_filter}')
    """))

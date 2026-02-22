"""rename_chaptergen_to_manuscriptedit

Revision ID: 024
Revises: 023
Create Date: 2025-12-16

Rename 'chapterGen' to 'manuscriptEdit' in:
1. function_configs JSONB column in user_settings table
2. function_type column in prompt_versions table
"""
from alembic import op
import sqlalchemy as sa

revision = '024'
down_revision = '023'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Rename 'chapterGen' key to 'manuscriptEdit' in existing data.
    """

    # Step 1: Rename the key in function_configs JSONB for user_settings
    # This renames 'chapterGen' to 'manuscriptEdit' while preserving the value
    op.execute("""
        UPDATE user_settings
        SET function_configs = (function_configs - 'chapterGen') ||
            jsonb_build_object('manuscriptEdit', function_configs->'chapterGen')
        WHERE function_configs ? 'chapterGen'
    """)

    # Step 2: Update function_type in prompt_versions table
    op.execute("""
        UPDATE prompt_versions
        SET function_type = 'manuscriptEdit'
        WHERE function_type = 'chapterGen'
    """)


def downgrade() -> None:
    """
    Revert 'manuscriptEdit' back to 'chapterGen'.
    """

    # Step 1: Rename the key back in function_configs JSONB for user_settings
    op.execute("""
        UPDATE user_settings
        SET function_configs = (function_configs - 'manuscriptEdit') ||
            jsonb_build_object('chapterGen', function_configs->'manuscriptEdit')
        WHERE function_configs ? 'manuscriptEdit'
    """)

    # Step 2: Update function_type in prompt_versions table
    op.execute("""
        UPDATE prompt_versions
        SET function_type = 'chapterGen'
        WHERE function_type = 'manuscriptEdit'
    """)

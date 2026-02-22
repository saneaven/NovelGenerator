"""rename_storyedit_to_storyobjectedit

Revision ID: 021
Revises: 020
Create Date: 2025-12-05

Rename 'storyEdit' to 'storyObjectEdit' in:
1. function_configs JSONB column in user_settings table
2. function_type column in prompt_versions table
"""
from alembic import op
import sqlalchemy as sa

revision = '021'
down_revision = '020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Rename 'storyEdit' key to 'storyObjectEdit' in existing data.
    """

    # Step 1: Rename the key in function_configs JSONB for user_settings
    # This renames 'storyEdit' to 'storyObjectEdit' while preserving the value
    op.execute("""
        UPDATE user_settings
        SET function_configs = (function_configs - 'storyEdit') ||
            jsonb_build_object('storyObjectEdit', function_configs->'storyEdit')
        WHERE function_configs ? 'storyEdit'
    """)

    # Step 2: Update function_type in prompt_versions table
    op.execute("""
        UPDATE prompt_versions
        SET function_type = 'storyObjectEdit'
        WHERE function_type = 'storyEdit'
    """)


def downgrade() -> None:
    """
    Revert 'storyObjectEdit' back to 'storyEdit'.
    """

    # Step 1: Rename the key back in function_configs JSONB for user_settings
    op.execute("""
        UPDATE user_settings
        SET function_configs = (function_configs - 'storyObjectEdit') ||
            jsonb_build_object('storyEdit', function_configs->'storyObjectEdit')
        WHERE function_configs ? 'storyObjectEdit'
    """)

    # Step 2: Update function_type in prompt_versions table
    op.execute("""
        UPDATE prompt_versions
        SET function_type = 'storyEdit'
        WHERE function_type = 'storyObjectEdit'
    """)

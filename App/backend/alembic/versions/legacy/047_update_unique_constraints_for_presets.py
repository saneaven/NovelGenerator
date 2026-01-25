"""update_unique_constraints_for_presets

Revision ID: 047
Revises: 046
Create Date: 2026-01-18

Update unique constraints on prompt_versions and prompt_fragments to include preset_id.
This allows the same prompts/fragments to exist in different presets for the same user.

Original constraints (created in migrations 003 and 027):
- idx_prompt_unique_version: (user_id, function_type, prompt_category, prompt_name, version_number)
- idx_fragment_unique_version: (user_id, folder_path, fragment_name, version_number)

New constraints:
- idx_prompt_unique_version: (preset_id, function_type, prompt_category, prompt_name, version_number)
- idx_fragment_unique_version: (preset_id, folder_path, fragment_name, version_number)
"""
from alembic import op
import sqlalchemy as sa

revision = '047'
down_revision = '046'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Update unique constraints to include preset_id instead of user_id.
    Uses DROP INDEX IF EXISTS for safety.
    """
    conn = op.get_bind()

    # 1. Update prompt_versions unique constraint
    conn.execute(sa.text("DROP INDEX IF EXISTS idx_prompt_unique_version"))
    op.create_index(
        'idx_prompt_unique_version',
        'prompt_versions',
        ['preset_id', 'function_type', 'prompt_category', 'prompt_name', 'version_number'],
        unique=True
    )

    # 2. Update prompt_fragments unique constraint
    conn.execute(sa.text("DROP INDEX IF EXISTS idx_fragment_unique_version"))
    op.create_index(
        'idx_fragment_unique_version',
        'prompt_fragments',
        ['preset_id', 'folder_path', 'fragment_name', 'version_number'],
        unique=True
    )

    # 3. Update prompt_fragments path index to include preset_id
    conn.execute(sa.text("DROP INDEX IF EXISTS idx_fragment_user_path"))
    op.create_index(
        'idx_fragment_preset_path',
        'prompt_fragments',
        ['preset_id', 'folder_path', 'fragment_name']
    )


def downgrade() -> None:
    """
    Revert unique constraints to original form (with user_id instead of preset_id).
    """
    conn = op.get_bind()

    # 1. Revert prompt_fragments path index
    conn.execute(sa.text("DROP INDEX IF EXISTS idx_fragment_preset_path"))
    op.create_index(
        'idx_fragment_user_path',
        'prompt_fragments',
        ['user_id', 'folder_path', 'fragment_name']
    )

    # 2. Revert prompt_fragments unique constraint
    conn.execute(sa.text("DROP INDEX IF EXISTS idx_fragment_unique_version"))
    op.create_index(
        'idx_fragment_unique_version',
        'prompt_fragments',
        ['user_id', 'folder_path', 'fragment_name', 'version_number'],
        unique=True
    )

    # 3. Revert prompt_versions unique constraint
    conn.execute(sa.text("DROP INDEX IF EXISTS idx_prompt_unique_version"))
    op.create_index(
        'idx_prompt_unique_version',
        'prompt_versions',
        ['user_id', 'function_type', 'prompt_category', 'prompt_name', 'version_number'],
        unique=True
    )

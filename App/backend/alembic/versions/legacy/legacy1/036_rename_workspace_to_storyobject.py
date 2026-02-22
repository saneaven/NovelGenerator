"""rename_workspace_to_storyobject

Revision ID: 036
Revises: 035
Create Date: 2025-12-31

Rename 'workspace' to 'storyObject' in prompt_versions table.
"""
from alembic import op

revision = '036'
down_revision = '035'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Rename 'workspace' to 'storyObject' in prompt_versions.
    """
    op.execute("""
        UPDATE prompt_versions
        SET prompt_name = 'storyObject'
        WHERE function_type = 'chat' AND prompt_name = 'workspace'
    """)


def downgrade() -> None:
    """
    Revert 'storyObject' back to 'workspace'.
    """
    op.execute("""
        UPDATE prompt_versions
        SET prompt_name = 'workspace'
        WHERE function_type = 'chat' AND prompt_name = 'storyObject'
    """)

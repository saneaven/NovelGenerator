"""Delete coverImage prompt versions — cover images now use the object prompt.

Revision ID: 0011_delete_cover_image_prompts
Revises: 0010_rename_prompt_name_to_task_subtype
Create Date: 2026-02-21
"""

from __future__ import annotations

from alembic import op


revision = "0011_delete_cover_image_prompts"
down_revision = "0010_rename_prompt_name_to_task_subtype"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "DELETE FROM prompt_versions WHERE task_type = 'imagePrompt' AND task_subtype = 'coverImage'"
    )


def downgrade() -> None:
    pass

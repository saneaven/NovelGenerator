"""Rename prompt_name column to task_subtype in prompt_versions table.

Revision ID: 0010_rename_prompt_name_to_task_subtype
Revises: 0009_folder_table
Create Date: 2026-02-20
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0010_rename_prompt_name_to_task_subtype"
down_revision = "0009_folder_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Alembic default schema may keep version_num at VARCHAR(32).
    # This revision ID is longer than 32 chars, so widen before upgrade bookkeeping.
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)")
    op.alter_column("prompt_versions", "prompt_name", new_column_name="task_subtype")


def downgrade() -> None:
    op.alter_column("prompt_versions", "task_subtype", new_column_name="prompt_name")

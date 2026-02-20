"""Replace string folder_path with PromptFolder table.

Revision ID: 0009_folder_table
Revises: 0008_thread_memory_scope
Create Date: 2026-02-20
"""

from __future__ import annotations

import uuid
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = "0009_folder_table"
down_revision = "0008_thread_memory_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create prompt_folders table
    op.create_table(
        "prompt_folders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("preset_id", UUID(as_uuid=True), sa.ForeignKey("prompt_presets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("parent_id", UUID(as_uuid=True), sa.ForeignKey("prompt_folders.id", ondelete="CASCADE"), nullable=True),
        sa.Column("display_order", sa.Integer, server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_prompt_folders_user_id", "prompt_folders", ["user_id"])
    op.create_index("ix_prompt_folders_preset_id", "prompt_folders", ["preset_id"])
    op.create_index("ix_prompt_folders_parent_id", "prompt_folders", ["parent_id"])
    op.create_index("idx_folder_preset_parent", "prompt_folders", ["preset_id", "parent_id"])
    op.create_unique_constraint("uq_folder_preset_parent_name", "prompt_folders", ["preset_id", "parent_id", "name"])

    # 2. Add folder_id column to prompt_fragments
    op.add_column("prompt_fragments", sa.Column("folder_id", UUID(as_uuid=True), nullable=True))

    # 3. Migrate data: create folder rows from existing folder_path strings
    bind = op.get_bind()

    rows = bind.execute(
        sa.text(
            "SELECT DISTINCT user_id, preset_id, folder_path "
            "FROM prompt_fragments "
            "WHERE folder_path IS NOT NULL AND folder_path != ''"
        )
    ).fetchall()

    # Cache: (user_id_str, preset_id_str, accumulated_path) -> folder_id
    folder_cache: dict[tuple[str, str, str], uuid.UUID] = {}
    now = datetime.utcnow()

    for user_id, preset_id, folder_path in rows:
        parts = folder_path.split("/")
        parent_id = None
        accumulated = ""

        for part in parts:
            accumulated = f"{accumulated}/{part}" if accumulated else part
            cache_key = (str(user_id), str(preset_id), accumulated)

            if cache_key in folder_cache:
                parent_id = folder_cache[cache_key]
                continue

            folder_id = uuid.uuid4()
            bind.execute(
                sa.text(
                    "INSERT INTO prompt_folders (id, user_id, preset_id, name, parent_id, display_order, created_at, updated_at) "
                    "VALUES (:id, :user_id, :preset_id, :name, :parent_id, 0, :now, :now)"
                ),
                {
                    "id": folder_id,
                    "user_id": user_id,
                    "preset_id": preset_id,
                    "name": part,
                    "parent_id": parent_id,
                    "now": now,
                },
            )
            folder_cache[cache_key] = folder_id
            parent_id = folder_id

        # Update fragments with this folder_path to point to the leaf folder
        bind.execute(
            sa.text(
                "UPDATE prompt_fragments SET folder_id = :folder_id "
                "WHERE user_id = :user_id AND preset_id = :preset_id AND folder_path = :folder_path"
            ),
            {
                "folder_id": parent_id,
                "user_id": user_id,
                "preset_id": preset_id,
                "folder_path": folder_path,
            },
        )

    # 4. Add FK constraint and index on folder_id
    op.create_foreign_key(
        "fk_fragment_folder",
        "prompt_fragments",
        "prompt_folders",
        ["folder_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_prompt_fragments_folder_id", "prompt_fragments", ["folder_id"])

    # 5. Drop old folder_path column
    op.drop_column("prompt_fragments", "folder_path")


def downgrade() -> None:
    # 1. Add folder_path column back
    op.add_column("prompt_fragments", sa.Column("folder_path", sa.String(200), nullable=True))

    # 2. Reconstruct folder_path from folder tree using recursive CTE
    bind = op.get_bind()
    bind.execute(
        sa.text("""
            WITH RECURSIVE folder_paths AS (
                SELECT id, name AS path
                FROM prompt_folders
                WHERE parent_id IS NULL
                UNION ALL
                SELECT f.id, fp.path || '/' || f.name
                FROM prompt_folders f
                JOIN folder_paths fp ON f.parent_id = fp.id
            )
            UPDATE prompt_fragments
            SET folder_path = fp.path
            FROM folder_paths fp
            WHERE prompt_fragments.folder_id = fp.id
        """)
    )

    # 3. Drop folder_id FK, index, and column
    op.drop_constraint("fk_fragment_folder", "prompt_fragments", type_="foreignkey")
    op.drop_index("ix_prompt_fragments_folder_id", "prompt_fragments")
    op.drop_column("prompt_fragments", "folder_id")

    # 4. Drop prompt_folders table (indexes/constraints cascade with it)
    op.drop_table("prompt_folders")

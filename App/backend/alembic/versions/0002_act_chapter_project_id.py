"""Add project_id to acts and chapters tables.

Acts and chapters previously only referenced their parent (outline/act) without
a direct link to the project. This adds project_id for consistent querying and
enables the reorder endpoint to work with these types.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "0002_act_chapter_project_id"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add nullable columns first
    op.add_column("acts", sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("chapters", sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))

    # 2. Backfill from parent relationships
    op.execute("""
        UPDATE acts
        SET project_id = outlines.project_id
        FROM outlines
        WHERE acts.outline_id = outlines.id
    """)

    op.execute("""
        UPDATE chapters
        SET project_id = outlines.project_id
        FROM acts
        JOIN outlines ON acts.outline_id = outlines.id
        WHERE chapters.act_id = acts.id
    """)

    # 3. Set NOT NULL constraint
    op.alter_column("acts", "project_id", nullable=False)
    op.alter_column("chapters", "project_id", nullable=False)

    # 4. Add foreign keys and indexes
    op.create_foreign_key("fk_acts_project_id", "acts", "projects", ["project_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_chapters_project_id", "chapters", "projects", ["project_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_acts_project_id", "acts", ["project_id"])
    op.create_index("ix_chapters_project_id", "chapters", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_chapters_project_id", "chapters")
    op.drop_index("ix_acts_project_id", "acts")
    op.drop_constraint("fk_chapters_project_id", "chapters", type_="foreignkey")
    op.drop_constraint("fk_acts_project_id", "acts", type_="foreignkey")
    op.drop_column("chapters", "project_id")
    op.drop_column("acts", "project_id")

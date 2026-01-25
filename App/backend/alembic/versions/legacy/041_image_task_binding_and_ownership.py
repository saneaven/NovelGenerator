"""image_task_binding_and_ownership

Revision ID: 041
Revises: 040
Create Date: 2026-01-16

Changes:
1) assets.manuscript_id FK ondelete -> CASCADE (ownership for scene assets)
2) assets.generation_reference_images JSONB column (regen restoration)
3) story_object_assets.asset_id UNIQUE (prevent sharing across objects)
   - deduplicate existing rows before adding constraint
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Update FK: assets.manuscript_id ondelete=CASCADE
    op.drop_constraint("fk_assets_manuscript", "assets", type_="foreignkey")
    op.create_foreign_key(
        "fk_assets_manuscript",
        "assets",
        "manuscripts",
        ["manuscript_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 2) Add generation_reference_images column
    op.add_column(
        "assets",
        sa.Column("generation_reference_images", postgresql.JSONB, nullable=True),
    )

    # 3) Enforce asset ownership uniqueness for story_object_assets.asset_id
    # Deduplicate: keep the earliest (created_at, id) per asset_id
    op.execute(
        sa.text(
            """
            WITH ranked AS (
              SELECT
                id,
                ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY created_at ASC, id ASC) AS rn
              FROM story_object_assets
            )
            DELETE FROM story_object_assets soa
            USING ranked r
            WHERE soa.id = r.id AND r.rn > 1
            """
        )
    )

    op.create_unique_constraint(
        "uq_story_object_assets_asset_id",
        "story_object_assets",
        ["asset_id"],
    )


def downgrade() -> None:
    # 3) Drop UNIQUE on story_object_assets.asset_id
    op.drop_constraint("uq_story_object_assets_asset_id", "story_object_assets", type_="unique")

    # 2) Drop generation_reference_images
    op.drop_column("assets", "generation_reference_images")

    # 1) Revert FK: assets.manuscript_id ondelete=SET NULL
    op.drop_constraint("fk_assets_manuscript", "assets", type_="foreignkey")
    op.create_foreign_key(
        "fk_assets_manuscript",
        "assets",
        "manuscripts",
        ["manuscript_id"],
        ["id"],
        ondelete="SET NULL",
    )


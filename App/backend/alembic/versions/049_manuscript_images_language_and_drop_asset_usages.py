"""manuscript_images_language_and_drop_asset_usages

Revision ID: 049
Revises: 048
Create Date: 2026-01-18

- Add `language` column to `manuscript_images` (language-scoped manuscript image index)
- Add supporting indexes for cleanup/usage queries
- Drop legacy `manuscript_asset_usages` table (usage derives from `manuscript_images`)
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) manuscript_images.language (nullable for legacy rows)
    op.add_column("manuscript_images", sa.Column("language", sa.String(length=50), nullable=True))

    # Supporting indexes for fast lookups:
    # - manuscript_id + language: rebuild/delete per language
    # - asset_id: used-by queries
    op.create_index(
        "ix_manuscript_images_manuscript_id_language",
        "manuscript_images",
        ["manuscript_id", "language"],
    )
    op.create_index(
        "ix_manuscript_images_asset_id",
        "manuscript_images",
        ["asset_id"],
    )

    # 2) Drop legacy manuscript_asset_usages (no longer used)
    op.drop_table("manuscript_asset_usages")


def downgrade() -> None:
    # 1) Recreate manuscript_asset_usages
    op.create_table(
        "manuscript_asset_usages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("manuscript_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["assets.id"],
            name="fk_manuscript_asset_usages_asset",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["manuscript_id"],
            ["manuscripts.id"],
            name="fk_manuscript_asset_usages_manuscript",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_manuscript_asset_usages_manuscript_id",
        "manuscript_asset_usages",
        ["manuscript_id"],
    )
    op.create_index(
        "ix_manuscript_asset_usages_asset_id",
        "manuscript_asset_usages",
        ["asset_id"],
    )
    op.create_index(
        "idx_manuscript_asset_usage",
        "manuscript_asset_usages",
        ["manuscript_id", "asset_id"],
        unique=True,
    )

    # 2) Drop indexes + language column from manuscript_images
    op.drop_index("ix_manuscript_images_asset_id", table_name="manuscript_images")
    op.drop_index("ix_manuscript_images_manuscript_id_language", table_name="manuscript_images")
    op.drop_column("manuscript_images", "language")

"""Add generation_mask_image column to assets."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012_asset_generation_mask_image"
down_revision = "0011_image_title_to_alt"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assets", sa.Column("generation_mask_image", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("assets", "generation_mask_image")

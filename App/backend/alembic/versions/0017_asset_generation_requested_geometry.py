"""Add requested geometry metadata to assets."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0017_asset_generation_requested_geometry"
down_revision = "0016_gpt_image_2_openai_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assets", sa.Column("generation_requested_aspect_ratio", sa.String(length=32), nullable=True))
    op.add_column("assets", sa.Column("generation_requested_image_size", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("assets", "generation_requested_image_size")
    op.drop_column("assets", "generation_requested_aspect_ratio")

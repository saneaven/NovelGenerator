"""Drop asset thumbnail fields.

Revision ID: 0014_drop_asset_thumbnails
Revises: 0013_add_asset_thumbnail_size_and_user_admin_quota
Create Date: 2026-01-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0014_drop_asset_thumbnails"
down_revision = "0013_add_asset_thumbnail_size_and_user_admin_quota"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    assets_cols = {c["name"] for c in inspector.get_columns("assets")}
    if "thumbnail_file_size" in assets_cols:
        op.drop_column("assets", "thumbnail_file_size")
    if "thumbnail_path" in assets_cols:
        op.drop_column("assets", "thumbnail_path")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    assets_cols = {c["name"] for c in inspector.get_columns("assets")}
    if "thumbnail_path" not in assets_cols:
        op.add_column("assets", sa.Column("thumbnail_path", sa.String(500), nullable=True))
    if "thumbnail_file_size" not in assets_cols:
        op.add_column(
            "assets",
            sa.Column(
                "thumbnail_file_size",
                sa.BigInteger(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )


"""Add asset thumbnail size + user admin/quota fields.

Revision ID: 0013_add_asset_thumbnail_size_and_user_admin_quota
Revises: 0012_manuscript_images_asset_fk_cascade
Create Date: 2026-01-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0013_add_asset_thumbnail_size_and_user_admin_quota"
down_revision = "0012_manuscript_images_asset_fk_cascade"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    assets_cols = {c["name"] for c in inspector.get_columns("assets")}
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

    users_cols = {c["name"] for c in inspector.get_columns("users")}

    if "is_admin" not in users_cols:
        op.add_column(
            "users",
            sa.Column(
                "is_admin",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )

    if "asset_quota_bytes" not in users_cols:
        op.add_column(
            "users",
            sa.Column(
                "asset_quota_bytes",
                sa.BigInteger(),
                nullable=True,
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    assets_cols = {c["name"] for c in inspector.get_columns("assets")}
    if "thumbnail_file_size" in assets_cols:
        op.drop_column("assets", "thumbnail_file_size")

    users_cols = {c["name"] for c in inspector.get_columns("users")}
    if "asset_quota_bytes" in users_cols:
        op.drop_column("users", "asset_quota_bytes")
    if "is_admin" in users_cols:
        op.drop_column("users", "is_admin")


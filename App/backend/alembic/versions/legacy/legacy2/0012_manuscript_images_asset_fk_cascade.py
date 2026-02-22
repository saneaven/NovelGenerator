"""Change manuscript_images.asset_id FK to ON DELETE CASCADE.

Revision ID: 0012_manuscript_images_asset_fk_cascade
Revises: 0011_remove_user_settings_provider_credentials
Create Date: 2026-01-30
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect


revision = "0012_manuscript_images_asset_fk_cascade"
down_revision = "0011_remove_user_settings_provider_credentials"
branch_labels = None
depends_on = None


_TABLE = "manuscript_images"
_COLUMN = "asset_id"
_REF_TABLE = "assets"
_REF_COLUMN = "id"


def _matching_fks(inspector) -> list[dict]:
    out: list[dict] = []
    for fk in inspector.get_foreign_keys(_TABLE):
        if fk.get("referred_table") != _REF_TABLE:
            continue
        if fk.get("constrained_columns") != [_COLUMN]:
            continue
        out.append(fk)
    return out


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    matching = _matching_fks(inspector)

    dropped_names: list[str] = []
    for fk in matching:
        name = fk.get("name")
        if name:
            op.drop_constraint(name, _TABLE, type_="foreignkey")
            dropped_names.append(name)

    fk_name = dropped_names[0] if dropped_names else f"{_TABLE}_{_COLUMN}_fkey"

    op.create_foreign_key(
        fk_name,
        _TABLE,
        _REF_TABLE,
        [_COLUMN],
        [_REF_COLUMN],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    matching = _matching_fks(inspector)

    dropped_names: list[str] = []
    for fk in matching:
        name = fk.get("name")
        if name:
            op.drop_constraint(name, _TABLE, type_="foreignkey")
            dropped_names.append(name)

    fk_name = dropped_names[0] if dropped_names else f"{_TABLE}_{_COLUMN}_fkey"

    op.create_foreign_key(
        fk_name,
        _TABLE,
        _REF_TABLE,
        [_COLUMN],
        [_REF_COLUMN],
        ondelete="SET NULL",
    )


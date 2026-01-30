"""Asset storage usage + quota enforcement (images only).

This module defines "storage usage" as bytes on disk for:
- originals (assets.file_size)

Ownership is derived from: users -> projects -> assets.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.db_models import Asset, Project, User


_DEFAULT_ASSET_QUOTA_BYTES_RAW = os.getenv("DEFAULT_ASSET_QUOTA_BYTES")
if not _DEFAULT_ASSET_QUOTA_BYTES_RAW:
    raise RuntimeError("DEFAULT_ASSET_QUOTA_BYTES must be set")
try:
    DEFAULT_ASSET_QUOTA_BYTES = int(_DEFAULT_ASSET_QUOTA_BYTES_RAW)
except ValueError:
    raise RuntimeError("DEFAULT_ASSET_QUOTA_BYTES must be an integer") from None
if DEFAULT_ASSET_QUOTA_BYTES < 0:
    raise RuntimeError("DEFAULT_ASSET_QUOTA_BYTES must be >= 0")


@dataclass(frozen=True)
class AssetStorageSnapshot:
    used_bytes: int
    quota_bytes: int

    @property
    def remaining_bytes(self) -> int:
        return max(self.quota_bytes - self.used_bytes, 0)

    @property
    def percent_used(self) -> float:
        if self.quota_bytes <= 0:
            return 1.0 if self.used_bytes > 0 else 0.0
        return min(self.used_bytes / self.quota_bytes, 1.0)


class StorageQuotaExceededError(RuntimeError):
    def __init__(self, *, used_bytes: int, quota_bytes: int, additional_bytes: int):
        super().__init__("Storage quota exceeded")
        self.used_bytes = int(used_bytes)
        self.quota_bytes = int(quota_bytes)
        self.additional_bytes = int(additional_bytes)


def resolve_user_asset_quota_bytes(user: User) -> int:
    override = getattr(user, "asset_quota_bytes", None)
    if isinstance(override, int) and override >= 0:
        return int(override)
    return int(DEFAULT_ASSET_QUOTA_BYTES)


def get_user_asset_used_bytes(db: Session, *, user_id: UUID) -> int:
    size_expr = func.coalesce(Asset.file_size, 0)
    total = (
        db.query(func.coalesce(func.sum(size_expr), 0))
        .join(Project, Project.id == Asset.project_id)
        .filter(Project.user_id == user_id)
        .scalar()
    )
    return int(total or 0)


def enforce_user_asset_quota(db: Session, *, user_id: UUID, additional_bytes: int) -> AssetStorageSnapshot:
    additional_bytes = max(int(additional_bytes or 0), 0)

    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    if not user:
        raise ValueError("User not found")

    quota_bytes = resolve_user_asset_quota_bytes(user)
    used_bytes = get_user_asset_used_bytes(db, user_id=user_id)

    if quota_bytes >= 0 and used_bytes + additional_bytes > quota_bytes:
        raise StorageQuotaExceededError(
            used_bytes=used_bytes,
            quota_bytes=quota_bytes,
            additional_bytes=additional_bytes,
        )

    return AssetStorageSnapshot(used_bytes=used_bytes, quota_bytes=quota_bytes)

"""Pydantic schemas for admin endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class AdminUserStorageItem(BaseModel):
    user_id: str
    email: str
    username: str
    is_admin: bool

    used_bytes: int
    quota_bytes: int
    remaining_bytes: int
    percent_used: float

    asset_quota_bytes_override: Optional[int] = None
    created_at: datetime


class AdminUsersStorageResponse(BaseModel):
    users: List[AdminUserStorageItem]
    total: int
    computed_at: datetime


class AdminUserUpdateRequest(BaseModel):
    is_admin: Optional[bool] = None
    asset_quota_bytes: Optional[int] = Field(default=None, ge=0)


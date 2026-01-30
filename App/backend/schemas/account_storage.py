"""Pydantic schemas for account storage/usage (assets only)."""

from __future__ import annotations

from datetime import datetime
from typing import List

from pydantic import BaseModel


class ProjectStorageBreakdown(BaseModel):
    project_id: str
    project_name: str
    asset_count: int
    used_bytes: int


class AccountStorageResponse(BaseModel):
    user_id: str
    used_bytes: int
    quota_bytes: int
    remaining_bytes: int
    percent_used: float
    by_project: List[ProjectStorageBreakdown]
    computed_at: datetime


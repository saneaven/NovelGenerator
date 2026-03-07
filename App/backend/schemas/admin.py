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

    storage_quota_bytes_override: Optional[int] = None
    created_at: datetime


class AdminUsersStorageResponse(BaseModel):
    users: List[AdminUserStorageItem]
    total: int
    computed_at: datetime


class AdminUserUpdateRequest(BaseModel):
    is_admin: Optional[bool] = None
    storage_quota_bytes: Optional[int] = Field(default=None, ge=0)


class AdminStorageReconcileRequest(BaseModel):
    scope: str = Field(pattern="^(dirty|stale|all|user|project)$")
    user_id: Optional[str] = None
    project_id: Optional[str] = None
    limit: Optional[int] = Field(default=None, ge=1, le=10000)
    apply: bool = True


class AdminStorageReconcileProjectResult(BaseModel):
    project_id: str
    before_total_bytes: int
    after_total_bytes: int
    drift_bytes: int
    needs_reconcile_after: bool
    status: str
    error: Optional[str] = None


class AdminStorageReconcileResponse(BaseModel):
    scope: str
    applied: bool
    scanned_projects: int
    reconciled_projects: int
    drifted_projects: int
    failed_projects: int
    results: List[AdminStorageReconcileProjectResult]


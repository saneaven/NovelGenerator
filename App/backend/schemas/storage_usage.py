"""Pydantic schemas for total project storage usage."""

from __future__ import annotations

from datetime import datetime
from typing import List

from pydantic import BaseModel


class StorageCategoryBreakdown(BaseModel):
    project_meta_bytes: int
    story_bytes: int
    manuscript_bytes: int
    chat_bytes: int
    notification_bytes: int
    image_run_bytes: int
    image_bytes: int
    llm_log_bytes: int
    total_bytes: int


class ProjectStorageBreakdown(BaseModel):
    project_id: str
    project_name: str
    used_bytes: int
    image_count: int
    categories: StorageCategoryBreakdown


class AccountStorageResponse(BaseModel):
    user_id: str
    used_bytes: int
    quota_bytes: int
    remaining_bytes: int
    percent_used: float
    by_project: List[ProjectStorageBreakdown]
    computed_at: datetime

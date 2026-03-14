from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


NotificationSourceKind = Literal["journey", "imageRun", "system"]
NotificationStatus = Literal[
    "running",
    "waiting",
    "processing",
    "paused",
    "done",
    "error",
    "canceled",
    "queued",
    "review",
    "applying",
    "applied",
    "rejected",
    "failed",
]
NotificationTargetKind = Literal["none", "project", "thread", "journey"]


class NotificationProgress(BaseModel):
    current: int | None = None
    total: int | None = None
    stage: str | None = None
    label: str | None = None
    percentage: float | None = None


class NotificationCustomSlot(BaseModel):
    type: Literal["none", "image"] = "none"
    url: str | None = None
    alt: str | None = None


class NotificationSource(BaseModel):
    kind: NotificationSourceKind
    id: str
    thread_id: str | None = None
    run_id: str | None = None
    journey_kind: str | None = None
    tool_call_id: str | None = None
    review_mode: str | None = None


class NotificationTarget(BaseModel):
    kind: NotificationTargetKind = "none"
    project_id: str | None = None
    thread_id: str | None = None
    journey_id: str | None = None


class NotificationResponse(BaseModel):
    id: str
    project_id: str | None = None
    source: NotificationSource
    status: NotificationStatus
    label: str
    message: str
    warning: str | None = None
    progress: NotificationProgress | None = None
    custom_slot: NotificationCustomSlot | None = None
    target: NotificationTarget
    meta: dict[str, Any] | None = None
    important: bool = False
    is_read: bool
    created_at: datetime
    updated_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    total: int


class MarkNotificationsReadRequest(BaseModel):
    notification_ids: list[str] = Field(default_factory=list)
    mark_all: bool = False


class MarkNotificationsReadResponse(BaseModel):
    updated: int
    ids: list[str]


class DeleteAllNotificationsRequest(BaseModel):
    only_read: bool = False


class DeleteAllNotificationsResponse(BaseModel):
    deleted: int
    ids: list[str]

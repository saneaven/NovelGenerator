"""Project-scoped logical storage usage, delta tracking, and reconcile helpers."""

from __future__ import annotations

import json
import logging
import os
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any, Callable, Iterable, Sequence
from uuid import UUID

from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.db_models import (
    Agent,
    Asset,
    BasicInfo,
    Guidelines,
    ImageRunModel,
    LLMLog,
    Manuscript,
    NotificationModel,
    Outline,
    Project,
    ProjectStorageUsage,
    RunMessageModel,
    RunMessageAttachmentModel,
    RunModel,
    RunToolCallModel,
    StoryEntity,
    Timeline,
    TimelineEvent,
    TimelineTrack,
    Thread,
    User,
)
from ..models.translation_models import ObjectVersion


logger = logging.getLogger(__name__)

RECONCILE_SCOPE_VALUES = {"dirty", "stale", "all", "user", "project"}

_DEFAULT_STORAGE_QUOTA_BYTES_RAW = os.getenv("DEFAULT_STORAGE_QUOTA_BYTES")
if not _DEFAULT_STORAGE_QUOTA_BYTES_RAW:
    raise RuntimeError("DEFAULT_STORAGE_QUOTA_BYTES must be set")
try:
    DEFAULT_STORAGE_QUOTA_BYTES = int(_DEFAULT_STORAGE_QUOTA_BYTES_RAW)
except ValueError:
    raise RuntimeError("DEFAULT_STORAGE_QUOTA_BYTES must be an integer") from None
if DEFAULT_STORAGE_QUOTA_BYTES < 0:
    raise RuntimeError("DEFAULT_STORAGE_QUOTA_BYTES must be >= 0")


STORY_ENTITY_CONTEXT_TYPES = (
    "basic_info",
    "guidelines",
    "story_entity",
    "outline",
    "timeline_track",
    "timeline_event",
)


@dataclass(frozen=True)
class StorageUsageBreakdown:
    project_meta_bytes: int = 0
    story_bytes: int = 0
    manuscript_bytes: int = 0
    chat_bytes: int = 0
    notification_bytes: int = 0
    image_run_bytes: int = 0
    image_bytes: int = 0
    llm_log_bytes: int = 0

    @property
    def total_bytes(self) -> int:
        return (
            int(self.project_meta_bytes)
            + int(self.story_bytes)
            + int(self.manuscript_bytes)
            + int(self.chat_bytes)
            + int(self.notification_bytes)
            + int(self.image_run_bytes)
            + int(self.image_bytes)
            + int(self.llm_log_bytes)
        )

    def as_dict(self) -> dict[str, int]:
        return {
            "project_meta_bytes": int(self.project_meta_bytes),
            "story_bytes": int(self.story_bytes),
            "manuscript_bytes": int(self.manuscript_bytes),
            "chat_bytes": int(self.chat_bytes),
            "notification_bytes": int(self.notification_bytes),
            "image_run_bytes": int(self.image_run_bytes),
            "image_bytes": int(self.image_bytes),
            "llm_log_bytes": int(self.llm_log_bytes),
            "total_bytes": int(self.total_bytes),
        }


@dataclass(frozen=True)
class StorageUsageDelta:
    project_meta_bytes: int = 0
    story_bytes: int = 0
    manuscript_bytes: int = 0
    chat_bytes: int = 0
    notification_bytes: int = 0
    image_run_bytes: int = 0
    image_bytes: int = 0
    llm_log_bytes: int = 0

    @property
    def total_bytes(self) -> int:
        return (
            int(self.project_meta_bytes)
            + int(self.story_bytes)
            + int(self.manuscript_bytes)
            + int(self.chat_bytes)
            + int(self.notification_bytes)
            + int(self.image_run_bytes)
            + int(self.image_bytes)
            + int(self.llm_log_bytes)
        )

    @property
    def is_zero(self) -> bool:
        return self.total_bytes == 0

    @classmethod
    def from_breakdowns(
        cls,
        *,
        before: StorageUsageBreakdown | None,
        after: StorageUsageBreakdown | None,
    ) -> "StorageUsageDelta":
        left = before or StorageUsageBreakdown()
        right = after or StorageUsageBreakdown()
        return cls(
            project_meta_bytes=int(right.project_meta_bytes) - int(left.project_meta_bytes),
            story_bytes=int(right.story_bytes) - int(left.story_bytes),
            manuscript_bytes=int(right.manuscript_bytes) - int(left.manuscript_bytes),
            chat_bytes=int(right.chat_bytes) - int(left.chat_bytes),
            notification_bytes=int(right.notification_bytes) - int(left.notification_bytes),
            image_run_bytes=int(right.image_run_bytes) - int(left.image_run_bytes),
            image_bytes=int(right.image_bytes) - int(left.image_bytes),
            llm_log_bytes=int(right.llm_log_bytes) - int(left.llm_log_bytes),
        )


@dataclass(frozen=True)
class StorageUsageSnapshot:
    used_bytes: int
    quota_bytes: int

    @property
    def remaining_bytes(self) -> int:
        return max(int(self.quota_bytes) - int(self.used_bytes), 0)

    @property
    def percent_used(self) -> float:
        if self.quota_bytes <= 0:
            return 1.0 if self.used_bytes > 0 else 0.0
        return min(float(self.used_bytes) / float(self.quota_bytes), 1.0)


@dataclass(frozen=True)
class StorageUsageReconcileProjectResult:
    project_id: UUID
    before: StorageUsageBreakdown
    after: StorageUsageBreakdown
    drift_bytes: int
    needs_reconcile_after: bool
    status: str
    error: str | None = None


@dataclass(frozen=True)
class StorageUsageReconcileBatchResult:
    scope: str
    applied: bool
    scanned_projects: int
    reconciled_projects: int
    drifted_projects: int
    failed_projects: int
    results: list[StorageUsageReconcileProjectResult]


class StorageQuotaExceededError(RuntimeError):
    def __init__(self, *, used_bytes: int, quota_bytes: int, additional_bytes: int):
        super().__init__("Storage quota exceeded")
        self.used_bytes = int(used_bytes)
        self.quota_bytes = int(quota_bytes)
        self.additional_bytes = int(additional_bytes)


def _measure_value(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    if isinstance(value, (dict, list)):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        return len(payload.encode("utf-8"))
    return 0


def _sum_values(*values: object) -> int:
    return sum(_measure_value(value) for value in values)


def measure_project_row(project: Project | object) -> int:
    return _sum_values(getattr(project, "name", None), getattr(project, "description", None))


def measure_story_core_row(row: object) -> int:
    return _sum_values(
        getattr(row, "image_prompt", None),
        getattr(row, "image_prompt_positive", None),
        getattr(row, "image_prompt_negative", None),
        getattr(row, "calendar", None),
        getattr(row, "color", None),
        getattr(row, "start_date", None),
        getattr(row, "end_date", None),
        getattr(row, "tags", None),
    )


def measure_object_version_row(version: ObjectVersion | object) -> int:
    return _sum_values(getattr(version, "data", None), getattr(version, "user_request", None))


def measure_agent_row(row: Agent | object) -> int:
    return _sum_values(getattr(row, "name", None))


def measure_thread_row(row: Thread | object) -> int:
    return _sum_values(
        getattr(row, "captured_history_system_prompt", None),
        getattr(row, "captured_history_conversation_json", None),
    )


def measure_run_row(row: RunModel | object) -> int:
    return _sum_values(
        getattr(row, "error", None),
        getattr(row, "context_object_ids", None),
        getattr(row, "journey_target_ids", None),
        getattr(row, "input_payload", None),
    )


def measure_run_message_row(row: RunMessageModel | object) -> int:
    return _sum_values(getattr(row, "data", None))


def measure_run_message_attachment_row(row: RunMessageAttachmentModel | object) -> int:
    return int(getattr(row, "file_size", 0) or 0) + _sum_values(
        getattr(row, "kind", None),
        getattr(row, "mime_type", None),
        getattr(row, "original_filename", None),
        getattr(row, "storage_key", None),
        getattr(row, "width", None),
        getattr(row, "height", None),
    )


def measure_tool_call_row(row: RunToolCallModel | object) -> int:
    return _sum_values(
        getattr(row, "arguments", None),
        getattr(row, "extra_content", None),
        getattr(row, "reason", None),
        getattr(row, "result", None),
    )


def measure_notification_row(row: NotificationModel | object) -> int:
    return _sum_values(
        getattr(row, "label", None),
        getattr(row, "message", None),
        getattr(row, "warning", None),
        getattr(row, "progress_json", None),
        getattr(row, "custom_slot_json", None),
        getattr(row, "meta_json", None),
    )


def measure_image_run_row(row: ImageRunModel | object) -> int:
    return _sum_values(
        getattr(row, "request_snapshot", None),
        getattr(row, "revised_prompt", None),
        getattr(row, "before_excerpt", None),
        getattr(row, "after_excerpt", None),
        getattr(row, "failure_code", None),
        getattr(row, "error_message", None),
    )


def measure_asset_row(row: Asset | object) -> int:
    return int(getattr(row, "file_size", 0) or 0) + _sum_values(
        getattr(row, "name", None),
        getattr(row, "generation_prompt", None),
        getattr(row, "generation_positive_prompt", None),
        getattr(row, "generation_negative_prompt", None),
        getattr(row, "generation_settings", None),
        getattr(row, "generation_reference_images", None),
        getattr(row, "generation_reference_objects", None),
    )


def _clone_measurement_value(value: Any) -> Any:
    return deepcopy(value)


def _snapshot_row(row: object | None, *fields: str) -> object | None:
    if row is None:
        return None
    payload = {field: _clone_measurement_value(getattr(row, field, None)) for field in fields}
    return SimpleNamespace(**payload)


def snapshot_project_row(row: Project | object | None) -> object | None:
    return _snapshot_row(row, "name", "description")


def snapshot_story_core_row(row: object | None) -> object | None:
    return _snapshot_row(
        row,
        "image_prompt",
        "image_prompt_positive",
        "image_prompt_negative",
        "calendar",
        "color",
        "start_date",
        "end_date",
        "tags",
    )


def snapshot_object_version_row(row: ObjectVersion | object | None) -> object | None:
    return _snapshot_row(row, "data", "user_request")


def snapshot_agent_row(row: Agent | object | None) -> object | None:
    return _snapshot_row(row, "name")


def snapshot_thread_row(row: Thread | object | None) -> object | None:
    return _snapshot_row(row, "captured_history_system_prompt", "captured_history_conversation_json")


def snapshot_run_row(row: RunModel | object | None) -> object | None:
    return _snapshot_row(row, "error", "context_object_ids", "journey_target_ids", "input_payload")


def snapshot_run_message_row(row: RunMessageModel | object | None) -> object | None:
    return _snapshot_row(row, "data")


def snapshot_run_message_attachment_row(row: RunMessageAttachmentModel | object | None) -> object | None:
    return _snapshot_row(row, "file_size", "kind", "mime_type", "original_filename", "storage_key", "width", "height")


def snapshot_tool_call_row(row: RunToolCallModel | object | None) -> object | None:
    return _snapshot_row(row, "arguments", "extra_content", "reason", "result")


def snapshot_notification_row(row: NotificationModel | object | None) -> object | None:
    return _snapshot_row(row, "label", "message", "warning", "progress_json", "custom_slot_json", "meta_json")


def snapshot_image_run_row(row: ImageRunModel | object | None) -> object | None:
    return _snapshot_row(row, "request_snapshot", "revised_prompt", "before_excerpt", "after_excerpt", "failure_code", "error_message")


def snapshot_asset_row(row: Asset | object | None) -> object | None:
    return _snapshot_row(
        row,
        "file_size",
        "name",
        "generation_prompt",
        "generation_positive_prompt",
        "generation_negative_prompt",
        "generation_settings",
        "generation_reference_images",
        "generation_reference_objects",
    )


def snapshot_rows(rows: Iterable[object], snapshot_fn: Callable[[object | None], object | None]) -> list[object]:
    return [snap for snap in (snapshot_fn(row) for row in rows) if snap is not None]


def _delta_from_amount(*, category: str, amount: int) -> StorageUsageDelta:
    payload = {
        "project_meta_bytes": 0,
        "story_bytes": 0,
        "manuscript_bytes": 0,
        "chat_bytes": 0,
        "notification_bytes": 0,
        "image_run_bytes": 0,
        "image_bytes": 0,
    }
    field = f"{category}_bytes"
    if field not in payload:
        raise ValueError(f"Unsupported storage category: {category}")
    payload[field] = int(amount)
    return StorageUsageDelta(**payload)


def combine_usage_deltas(*deltas: StorageUsageDelta) -> StorageUsageDelta:
    return StorageUsageDelta(
        project_meta_bytes=sum(int(delta.project_meta_bytes) for delta in deltas),
        story_bytes=sum(int(delta.story_bytes) for delta in deltas),
        manuscript_bytes=sum(int(delta.manuscript_bytes) for delta in deltas),
        chat_bytes=sum(int(delta.chat_bytes) for delta in deltas),
        notification_bytes=sum(int(delta.notification_bytes) for delta in deltas),
        image_run_bytes=sum(int(delta.image_run_bytes) for delta in deltas),
        image_bytes=sum(int(delta.image_bytes) for delta in deltas),
    )


def build_usage_delta_for_measurement(
    *,
    category: str,
    before: object | None,
    after: object | None,
    measure_fn: Callable[[object], int],
) -> StorageUsageDelta:
    before_amount = int(measure_fn(before) if before is not None else 0)
    after_amount = int(measure_fn(after) if after is not None else 0)
    return _delta_from_amount(category=category, amount=after_amount - before_amount)


def build_usage_delta_for_measurement_rows(
    *,
    category: str,
    before_rows: Sequence[object] | None,
    after_rows: Sequence[object] | None,
    measure_fn: Callable[[object], int],
) -> StorageUsageDelta:
    before_amount = sum(int(measure_fn(row)) for row in (before_rows or []))
    after_amount = sum(int(measure_fn(row)) for row in (after_rows or []))
    return _delta_from_amount(category=category, amount=after_amount - before_amount)


def build_usage_delta_for_object_version(
    *,
    object_type: str,
    before: object | None,
    after: object | None,
) -> StorageUsageDelta:
    category = "manuscript" if str(object_type or "").strip() == "manuscript" else "story"
    return build_usage_delta_for_measurement(
        category=category,
        before=before,
        after=after,
        measure_fn=measure_object_version_row,
    )


def build_object_version_delta(
    *,
    object_type: str,
    before: object | None,
    after: object | None,
) -> StorageUsageDelta:
    return build_usage_delta_for_object_version(
        object_type=object_type,
        before=before,
        after=after,
    )


def build_project_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="project_meta",
        before=before,
        after=after,
        measure_fn=measure_project_row,
    )


def build_story_core_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="story",
        before=before,
        after=after,
        measure_fn=measure_story_core_row,
    )


def build_story_core_rows_delta(
    before_rows: Sequence[object] | None,
    after_rows: Sequence[object] | None,
) -> StorageUsageDelta:
    return build_usage_delta_for_measurement_rows(
        category="story",
        before_rows=before_rows,
        after_rows=after_rows,
        measure_fn=measure_story_core_row,
    )


def build_agent_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="chat",
        before=before,
        after=after,
        measure_fn=measure_agent_row,
    )


def build_thread_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="chat",
        before=before,
        after=after,
        measure_fn=measure_thread_row,
    )


def build_run_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="chat",
        before=before,
        after=after,
        measure_fn=measure_run_row,
    )


def build_run_message_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="chat",
        before=before,
        after=after,
        measure_fn=measure_run_message_row,
    )


def build_run_message_attachment_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="chat",
        before=before,
        after=after,
        measure_fn=measure_run_message_attachment_row,
    )


def build_tool_call_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="chat",
        before=before,
        after=after,
        measure_fn=measure_tool_call_row,
    )


def build_notification_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="notification",
        before=before,
        after=after,
        measure_fn=measure_notification_row,
    )


def build_notification_rows_delta(
    before_rows: Sequence[object] | None,
    after_rows: Sequence[object] | None,
) -> StorageUsageDelta:
    return build_usage_delta_for_measurement_rows(
        category="notification",
        before_rows=before_rows,
        after_rows=after_rows,
        measure_fn=measure_notification_row,
    )


def build_image_run_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="image_run",
        before=before,
        after=after,
        measure_fn=measure_image_run_row,
    )


def build_asset_delta(before: object | None, after: object | None) -> StorageUsageDelta:
    return build_usage_delta_for_measurement(
        category="image",
        before=before,
        after=after,
        measure_fn=measure_asset_row,
    )


def build_asset_rows_delta(
    before_rows: Sequence[object] | None,
    after_rows: Sequence[object] | None,
) -> StorageUsageDelta:
    return build_usage_delta_for_measurement_rows(
        category="image",
        before_rows=before_rows,
        after_rows=after_rows,
        measure_fn=measure_asset_row,
    )


def resolve_user_storage_quota_bytes(user: User) -> int:
    override = getattr(user, "storage_quota_bytes", None)
    if isinstance(override, int) and override >= 0:
        return int(override)
    return int(DEFAULT_STORAGE_QUOTA_BYTES)


def get_user_used_bytes(db: Session, *, user_id: UUID) -> int:
    total = (
        db.query(func.coalesce(func.sum(ProjectStorageUsage.total_bytes), 0))
        .filter(ProjectStorageUsage.user_id == user_id)
        .scalar()
    )
    return int(total or 0)


def get_user_storage_snapshot(db: Session, *, user_id: UUID) -> StorageUsageSnapshot:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise ValueError("User not found")
    return StorageUsageSnapshot(
        used_bytes=get_user_used_bytes(db, user_id=user_id),
        quota_bytes=resolve_user_storage_quota_bytes(user),
    )


def enforce_user_storage_quota(db: Session, *, user_id: UUID, additional_bytes: int = 0) -> StorageUsageSnapshot:
    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    if user is None:
        raise ValueError("User not found")

    additional = max(int(additional_bytes or 0), 0)
    snapshot = StorageUsageSnapshot(
        used_bytes=get_user_used_bytes(db, user_id=user_id),
        quota_bytes=resolve_user_storage_quota_bytes(user),
    )
    if snapshot.quota_bytes >= 0 and snapshot.used_bytes + additional > snapshot.quota_bytes:
        raise StorageQuotaExceededError(
            used_bytes=snapshot.used_bytes,
            quota_bytes=snapshot.quota_bytes,
            additional_bytes=additional,
        )
    return snapshot


def _uuid_rows(rows: list[object]) -> list[UUID]:
    out: list[UUID] = []
    for row in rows:
        if isinstance(row, UUID):
            value = row
        else:
            try:
                value = row[0]  # type: ignore[index]
            except (TypeError, KeyError, IndexError):
                value = row
        if isinstance(value, UUID):
            out.append(value)
    return out


def _collect_project_object_ids(db: Session, *, project_id: UUID) -> dict[str, list[UUID]]:
    basic_info_ids = _uuid_rows(db.query(BasicInfo.id).filter(BasicInfo.project_id == project_id).all())
    guideline_ids = _uuid_rows(db.query(Guidelines.id).filter(Guidelines.project_id == project_id).all())
    story_entity_ids = _uuid_rows(db.query(StoryEntity.id).filter(StoryEntity.project_id == project_id).all())
    outline_ids = _uuid_rows(db.query(Outline.id).filter(Outline.project_id == project_id).all())
    timeline_track_ids = _uuid_rows(
        db.query(TimelineTrack.id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
        .all()
    )
    timeline_event_ids = _uuid_rows(
        db.query(TimelineEvent.id)
        .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
        .all()
    )
    manuscript_ids = _uuid_rows(
        db.query(Manuscript.id)
        .join(Outline, Outline.id == Manuscript.chapter_id)
        .filter(Outline.project_id == project_id, Outline.kind == "chapter")
        .all()
    )
    return {
        "basic_info": basic_info_ids,
        "guidelines": guideline_ids,
        "story_entity": story_entity_ids,
        "outline": outline_ids,
        "manuscript": manuscript_ids,
        "timeline_track": timeline_track_ids,
        "timeline_event": timeline_event_ids,
    }


def _sum_object_versions(
    db: Session,
    *,
    ids_by_type: dict[str, list[UUID]],
    allowed_types: tuple[str, ...],
) -> int:
    total = 0
    for object_type in allowed_types:
        object_ids = ids_by_type.get(object_type) or []
        if not object_ids:
            continue
        rows = (
            db.query(ObjectVersion)
            .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id.in_(object_ids))
            .all()
        )
        total += sum(measure_object_version_row(row) for row in rows)
    return int(total)


def _get_or_create_usage_row(db: Session, *, project_id: UUID, user_id: UUID) -> ProjectStorageUsage:
    row = db.query(ProjectStorageUsage).filter(ProjectStorageUsage.project_id == project_id).first()
    if row is not None:
        return row
    row = ProjectStorageUsage(project_id=project_id, user_id=user_id)
    db.add(row)
    db.flush()
    return row


def _breakdown_from_usage_row(row: ProjectStorageUsage | None) -> StorageUsageBreakdown:
    if row is None:
        return StorageUsageBreakdown()
    return StorageUsageBreakdown(
        project_meta_bytes=int(row.project_meta_bytes or 0),
        story_bytes=int(row.story_bytes or 0),
        manuscript_bytes=int(row.manuscript_bytes or 0),
        chat_bytes=int(row.chat_bytes or 0),
        notification_bytes=int(row.notification_bytes or 0),
        image_run_bytes=int(row.image_run_bytes or 0),
        image_bytes=int(row.image_bytes or 0),
        llm_log_bytes=int(row.llm_log_bytes or 0),
    )


def get_project_usage_breakdown(db: Session, *, project_id: UUID) -> StorageUsageBreakdown:
    row = db.query(ProjectStorageUsage).filter(ProjectStorageUsage.project_id == project_id).first()
    return _breakdown_from_usage_row(row)


def mark_project_usage_for_reconcile(db: Session, *, project_id: UUID, user_id: UUID | None = None) -> None:
    project = db.query(Project).filter(Project.id == project_id).first()
    row = db.query(ProjectStorageUsage).filter(ProjectStorageUsage.project_id == project_id).first()
    if project is None and row is None:
        return
    effective_user_id = user_id or (project.user_id if project is not None else row.user_id)
    if row is None:
        row = _get_or_create_usage_row(db, project_id=project_id, user_id=effective_user_id)
    row.user_id = effective_user_id
    row.needs_reconcile = True
    db.flush()


def _set_usage_row_breakdown(
    row: ProjectStorageUsage,
    *,
    breakdown: StorageUsageBreakdown,
    needs_reconcile: bool,
    last_reconciled_at: datetime | None,
) -> None:
    row.project_meta_bytes = int(breakdown.project_meta_bytes)
    row.story_bytes = int(breakdown.story_bytes)
    row.manuscript_bytes = int(breakdown.manuscript_bytes)
    row.chat_bytes = int(breakdown.chat_bytes)
    row.notification_bytes = int(breakdown.notification_bytes)
    row.image_run_bytes = int(breakdown.image_run_bytes)
    row.image_bytes = int(breakdown.image_bytes)
    row.llm_log_bytes = int(breakdown.llm_log_bytes)
    row.total_bytes = int(breakdown.total_bytes)
    row.needs_reconcile = bool(needs_reconcile)
    row.last_reconciled_at = last_reconciled_at


def _calculate_project_usage_breakdown(db: Session, *, project_id: UUID) -> StorageUsageBreakdown:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        return StorageUsageBreakdown()

    ids_by_type = _collect_project_object_ids(db, project_id=project_id)
    project_meta_bytes = measure_project_row(project)

    story_core_rows: list[object] = []
    story_core_rows.extend(db.query(BasicInfo).filter(BasicInfo.project_id == project_id).all())
    story_core_rows.extend(db.query(Guidelines).filter(Guidelines.project_id == project_id).all())
    story_core_rows.extend(db.query(StoryEntity).filter(StoryEntity.project_id == project_id).all())
    story_core_rows.extend(db.query(Outline).filter(Outline.project_id == project_id).all())
    story_core_rows.extend(db.query(Timeline).filter(Timeline.project_id == project_id).all())
    story_core_rows.extend(
        db.query(TimelineTrack)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
        .all()
    )
    story_core_rows.extend(
        db.query(TimelineEvent)
        .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
        .all()
    )
    story_bytes = sum(measure_story_core_row(row) for row in story_core_rows)
    story_bytes += _sum_object_versions(db, ids_by_type=ids_by_type, allowed_types=STORY_ENTITY_CONTEXT_TYPES)

    manuscript_bytes = _sum_object_versions(db, ids_by_type=ids_by_type, allowed_types=("manuscript",))

    agents = db.query(Agent).filter(Agent.project_id == project_id).all()
    threads = db.query(Thread).filter(Thread.project_id == project_id).all()
    runs = db.query(RunModel).filter(RunModel.project_id == project_id).all()
    run_messages = (
        db.query(RunMessageModel)
        .join(RunModel, RunModel.id == RunMessageModel.run_id)
        .filter(RunModel.project_id == project_id)
        .all()
    )
    run_message_attachments = (
        db.query(RunMessageAttachmentModel)
        .filter(RunMessageAttachmentModel.project_id == project_id)
        .all()
    )
    tool_calls = (
        db.query(RunToolCallModel)
        .join(RunModel, RunModel.id == RunToolCallModel.run_id)
        .filter(RunModel.project_id == project_id)
        .all()
    )
    chat_bytes = (
        sum(measure_agent_row(row) for row in agents)
        + sum(measure_thread_row(row) for row in threads)
        + sum(measure_run_row(row) for row in runs)
        + sum(measure_run_message_row(row) for row in run_messages)
        + sum(measure_run_message_attachment_row(row) for row in run_message_attachments)
        + sum(measure_tool_call_row(row) for row in tool_calls)
    )

    notifications = db.query(NotificationModel).filter(NotificationModel.project_id == project_id).all()
    notification_bytes = sum(measure_notification_row(row) for row in notifications)

    image_runs = db.query(ImageRunModel).filter(ImageRunModel.project_id == project_id).all()
    image_run_bytes = sum(measure_image_run_row(row) for row in image_runs)

    assets = db.query(Asset).filter(Asset.project_id == project_id).all()
    image_bytes = sum(measure_asset_row(row) for row in assets)

    from .llm_log_service import _measure_log_row
    llm_logs = db.query(LLMLog).filter(LLMLog.project_id == project_id).all()
    llm_log_bytes = sum(_measure_log_row(row) for row in llm_logs)

    return StorageUsageBreakdown(
        project_meta_bytes=int(project_meta_bytes),
        story_bytes=int(story_bytes),
        manuscript_bytes=int(manuscript_bytes),
        chat_bytes=int(chat_bytes),
        notification_bytes=int(notification_bytes),
        image_run_bytes=int(image_run_bytes),
        image_bytes=int(image_bytes),
        llm_log_bytes=int(llm_log_bytes),
    )


def recalculate_project_usage(db: Session, *, project_id: UUID) -> StorageUsageBreakdown:
    """Full recomputation entrypoint reserved for reconcile/import/admin paths."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        stale = db.query(ProjectStorageUsage).filter(ProjectStorageUsage.project_id == project_id).first()
        if stale is not None:
            db.delete(stale)
            db.flush()
        return StorageUsageBreakdown()

    breakdown = _calculate_project_usage_breakdown(db, project_id=project_id)
    row = _get_or_create_usage_row(db, project_id=project_id, user_id=project.user_id)
    row.user_id = project.user_id
    _set_usage_row_breakdown(
        row,
        breakdown=breakdown,
        needs_reconcile=False,
        last_reconciled_at=datetime.utcnow(),
    )
    db.flush()
    return breakdown


def recalculate_project_usage_and_enforce_quota(
    db: Session,
    *,
    project_id: UUID,
    user_id: UUID,
) -> StorageUsageSnapshot:
    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    if user is None:
        raise ValueError("User not found")
    recalculate_project_usage(db, project_id=project_id)
    snapshot = StorageUsageSnapshot(
        used_bytes=get_user_used_bytes(db, user_id=user_id),
        quota_bytes=resolve_user_storage_quota_bytes(user),
    )
    if snapshot.quota_bytes >= 0 and snapshot.used_bytes > snapshot.quota_bytes:
        raise StorageQuotaExceededError(
            used_bytes=snapshot.used_bytes,
            quota_bytes=snapshot.quota_bytes,
            additional_bytes=0,
        )
    return snapshot


def apply_project_usage_delta(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    delta: StorageUsageDelta,
    enforce_quota: bool,
) -> StorageUsageSnapshot:
    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    if user is None:
        raise ValueError("User not found")
    if delta.is_zero:
        return StorageUsageSnapshot(
            used_bytes=get_user_used_bytes(db, user_id=user_id),
            quota_bytes=resolve_user_storage_quota_bytes(user),
        )

    row = _get_or_create_usage_row(db, project_id=project_id, user_id=user_id)
    row.user_id = user_id
    clamped = False

    for field in (
        "project_meta_bytes",
        "story_bytes",
        "manuscript_bytes",
        "chat_bytes",
        "notification_bytes",
        "image_run_bytes",
        "image_bytes",
        "llm_log_bytes",
    ):
        current_value = int(getattr(row, field) or 0)
        next_value = current_value + int(getattr(delta, field))
        if next_value < 0:
            next_value = 0
            clamped = True
        setattr(row, field, next_value)

    row.total_bytes = (
        int(row.project_meta_bytes or 0)
        + int(row.story_bytes or 0)
        + int(row.manuscript_bytes or 0)
        + int(row.chat_bytes or 0)
        + int(row.notification_bytes or 0)
        + int(row.image_run_bytes or 0)
        + int(row.image_bytes or 0)
        + int(row.llm_log_bytes or 0)
    )
    if clamped:
        row.needs_reconcile = True
        logger.warning(
            "Storage usage delta clamp triggered for project %s; marking reconcile dirty",
            project_id,
        )
    db.flush()

    snapshot = StorageUsageSnapshot(
        used_bytes=get_user_used_bytes(db, user_id=user_id),
        quota_bytes=resolve_user_storage_quota_bytes(user),
    )
    if enforce_quota and delta.total_bytes > 0 and snapshot.quota_bytes >= 0 and snapshot.used_bytes > snapshot.quota_bytes:
        raise StorageQuotaExceededError(
            used_bytes=snapshot.used_bytes,
            quota_bytes=snapshot.quota_bytes,
            additional_bytes=delta.total_bytes,
        )
    return snapshot


def apply_project_usage_deltas(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    deltas: Sequence[StorageUsageDelta],
    enforce_quota: bool,
) -> StorageUsageSnapshot:
    return apply_project_usage_delta(
        db,
        user_id=user_id,
        project_id=project_id,
        delta=combine_usage_deltas(*deltas),
        enforce_quota=enforce_quota,
    )


def _validate_reconcile_scope(scope: str) -> str:
    normalized = str(scope or "").strip()
    if normalized not in RECONCILE_SCOPE_VALUES:
        raise ValueError(f"Unsupported reconcile scope: {normalized}")
    return normalized


def list_reconcile_project_ids(
    db: Session,
    *,
    scope: str,
    limit: int | None = None,
    stale_after_seconds: int | None = None,
    user_id: UUID | None = None,
    project_id: UUID | None = None,
    exclude_project_ids: Sequence[UUID] | None = None,
) -> list[UUID]:
    normalized_scope = _validate_reconcile_scope(scope)
    q = (
        db.query(Project.id)
        .outerjoin(ProjectStorageUsage, ProjectStorageUsage.project_id == Project.id)
    )
    if exclude_project_ids:
        q = q.filter(~Project.id.in_(list(exclude_project_ids)))

    if normalized_scope == "project":
        if project_id is None:
            raise ValueError("project_id is required for project scope")
        q = q.filter(Project.id == project_id)
    elif normalized_scope == "user":
        if user_id is None:
            raise ValueError("user_id is required for user scope")
        q = q.filter(Project.user_id == user_id)
    elif normalized_scope == "dirty":
        q = q.filter(ProjectStorageUsage.needs_reconcile.is_(True))
    elif normalized_scope == "stale":
        stale_after = max(int(stale_after_seconds or 0), 1)
        cutoff = datetime.utcnow() - timedelta(seconds=stale_after)
        q = q.filter(
            or_(
                ProjectStorageUsage.project_id.is_(None),
                ProjectStorageUsage.last_reconciled_at.is_(None),
                ProjectStorageUsage.last_reconciled_at < cutoff,
            )
        )

    q = q.order_by(
        ProjectStorageUsage.needs_reconcile.desc(),
        ProjectStorageUsage.last_reconciled_at.asc().nullsfirst(),
        Project.updated_at.desc(),
        Project.id.asc(),
    )
    if limit is not None:
        q = q.limit(max(int(limit), 1))
    return [project_id for (project_id,) in q.all() if isinstance(project_id, UUID)]


def reconcile_project_usage(
    db: Session,
    *,
    project_id: UUID,
    apply: bool,
) -> StorageUsageReconcileProjectResult:
    before_row = db.query(ProjectStorageUsage).filter(ProjectStorageUsage.project_id == project_id).first()
    before = _breakdown_from_usage_row(before_row)

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        if apply and before_row is not None:
            db.delete(before_row)
            db.flush()
        return StorageUsageReconcileProjectResult(
            project_id=project_id,
            before=before,
            after=StorageUsageBreakdown(),
            drift_bytes=-before.total_bytes,
            needs_reconcile_after=False,
            status="missing",
        )

    after = _calculate_project_usage_breakdown(db, project_id=project_id)
    drift = int(after.total_bytes) - int(before.total_bytes)
    drifted = before.as_dict() != after.as_dict()
    needs_reconcile_after = bool(before_row.needs_reconcile) if before_row is not None else False
    status = "unchanged"

    if apply:
        row = _get_or_create_usage_row(db, project_id=project_id, user_id=project.user_id)
        row.user_id = project.user_id
        _set_usage_row_breakdown(
            row,
            breakdown=after,
            needs_reconcile=False,
            last_reconciled_at=datetime.utcnow(),
        )
        db.flush()
        needs_reconcile_after = False
        status = "reconciled" if drifted or (before_row and before_row.needs_reconcile) else "unchanged"
    elif drifted:
        needs_reconcile_after = True
        status = "drifted"

    return StorageUsageReconcileProjectResult(
        project_id=project_id,
        before=before,
        after=after,
        drift_bytes=drift,
        needs_reconcile_after=needs_reconcile_after,
        status=status,
    )


def run_storage_usage_reconcile_batch(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    scope: str,
    apply: bool,
    limit: int | None = None,
    stale_after_seconds: int | None = None,
    user_id: UUID | None = None,
    project_id: UUID | None = None,
    project_ids: Sequence[UUID] | None = None,
) -> StorageUsageReconcileBatchResult:
    normalized_scope = _validate_reconcile_scope(scope)
    with session_factory() as db:
        target_project_ids = list(project_ids or list_reconcile_project_ids(
            db,
            scope=normalized_scope,
            limit=limit,
            stale_after_seconds=stale_after_seconds,
            user_id=user_id,
            project_id=project_id,
        ))

    results: list[StorageUsageReconcileProjectResult] = []
    failed_projects = 0

    for target_project_id in target_project_ids:
        db = session_factory()
        try:
            result = reconcile_project_usage(db, project_id=target_project_id, apply=apply)
            if apply:
                db.commit()
            else:
                db.rollback()
            results.append(result)
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            failed_projects += 1
            logger.exception("Storage usage reconcile failed for project %s", target_project_id)
            results.append(
                StorageUsageReconcileProjectResult(
                    project_id=target_project_id,
                    before=StorageUsageBreakdown(),
                    after=StorageUsageBreakdown(),
                    drift_bytes=0,
                    needs_reconcile_after=True,
                    status="failed",
                    error=str(exc),
                )
            )
        finally:
            db.close()

    reconciled_projects = sum(1 for result in results if result.status in {"reconciled", "unchanged", "drifted", "missing"})
    drifted_projects = sum(1 for result in results if result.before.as_dict() != result.after.as_dict())

    return StorageUsageReconcileBatchResult(
        scope=normalized_scope,
        applied=bool(apply),
        scanned_projects=len(target_project_ids),
        reconciled_projects=reconciled_projects,
        drifted_projects=drifted_projects,
        failed_projects=failed_projects,
        results=results,
    )


def select_reconcile_cycle_project_ids(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    batch_size: int,
    stale_after_seconds: int,
) -> list[UUID]:
    limit = max(int(batch_size), 1)
    with session_factory() as db:
        dirty_ids = list_reconcile_project_ids(db, scope="dirty", limit=limit)
        remaining = limit - len(dirty_ids)
        if remaining <= 0:
            return dirty_ids
        stale_ids = list_reconcile_project_ids(
            db,
            scope="stale",
            limit=remaining,
            stale_after_seconds=stale_after_seconds,
            exclude_project_ids=dirty_ids,
        )
        return dirty_ids + stale_ids


def run_storage_usage_reconcile_cycle(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    batch_size: int,
    stale_after_seconds: int,
) -> StorageUsageReconcileBatchResult:
    target_ids = select_reconcile_cycle_project_ids(
        session_factory=session_factory,
        batch_size=batch_size,
        stale_after_seconds=stale_after_seconds,
    )
    return run_storage_usage_reconcile_batch(
        session_factory=session_factory,
        scope="dirty",
        apply=True,
        project_ids=target_ids,
    )


def try_acquire_reconcile_advisory_lock(db: Session, *, lock_key: int) -> bool:
    value = db.execute(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": int(lock_key)},
    ).scalar()
    return bool(value)


def release_reconcile_advisory_lock(db: Session, *, lock_key: int) -> bool:
    value = db.execute(
        text("SELECT pg_advisory_unlock(:lock_key)"),
        {"lock_key": int(lock_key)},
    ).scalar()
    return bool(value)


__all__ = [
    "DEFAULT_STORAGE_QUOTA_BYTES",
    "StorageQuotaExceededError",
    "StorageUsageBreakdown",
    "StorageUsageDelta",
    "StorageUsageReconcileBatchResult",
    "StorageUsageReconcileProjectResult",
    "StorageUsageSnapshot",
    "apply_project_usage_delta",
    "apply_project_usage_deltas",
    "build_agent_delta",
    "build_asset_delta",
    "build_asset_rows_delta",
    "build_image_run_delta",
    "build_notification_delta",
    "build_notification_rows_delta",
    "build_object_version_delta",
    "build_project_delta",
    "build_run_delta",
    "build_run_message_delta",
    "build_run_message_attachment_delta",
    "build_story_core_delta",
    "build_story_core_rows_delta",
    "build_thread_delta",
    "build_tool_call_delta",
    "build_usage_delta_for_measurement",
    "build_usage_delta_for_measurement_rows",
    "build_usage_delta_for_object_version",
    "combine_usage_deltas",
    "enforce_user_storage_quota",
    "get_project_usage_breakdown",
    "get_user_storage_snapshot",
    "get_user_used_bytes",
    "list_reconcile_project_ids",
    "mark_project_usage_for_reconcile",
    "measure_agent_row",
    "measure_asset_row",
    "measure_image_run_row",
    "measure_notification_row",
    "measure_object_version_row",
    "measure_project_row",
    "measure_run_message_row",
    "measure_run_message_attachment_row",
    "measure_run_row",
    "measure_story_core_row",
    "measure_thread_row",
    "measure_tool_call_row",
    "recalculate_project_usage",
    "recalculate_project_usage_and_enforce_quota",
    "reconcile_project_usage",
    "release_reconcile_advisory_lock",
    "resolve_user_storage_quota_bytes",
    "run_storage_usage_reconcile_batch",
    "run_storage_usage_reconcile_cycle",
    "select_reconcile_cycle_project_ids",
    "snapshot_agent_row",
    "snapshot_asset_row",
    "snapshot_image_run_row",
    "snapshot_notification_row",
    "snapshot_object_version_row",
    "snapshot_project_row",
    "snapshot_rows",
    "snapshot_run_message_row",
    "snapshot_run_message_attachment_row",
    "snapshot_run_row",
    "snapshot_story_core_row",
    "snapshot_thread_row",
    "snapshot_tool_call_row",
    "try_acquire_reconcile_advisory_lock",
]

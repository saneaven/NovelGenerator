from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.db_models import (
    ImageRunModel,
    NotificationModel,
    RunMessageModel,
    RunModel,
    RunToolCallModel,
    Thread,
)
from .storage_usage_service import (
    StorageUsageDelta,
    apply_project_usage_delta,
    build_image_run_delta,
    build_notification_delta,
    build_run_delta,
    build_run_message_delta,
    build_thread_delta,
    build_tool_call_delta,
    snapshot_image_run_row,
    snapshot_notification_row,
    snapshot_run_message_row,
    snapshot_run_row,
    snapshot_thread_row,
    snapshot_tool_call_row,
)


NOTIFICATION_SOURCE_VALUES = {"journey", "imageRun"}
NOTIFICATION_STATUS_VALUES = {"running", "pending", "success", "error", "cancelled"}
ACTIVE_THREAD_DELETE_STATUSES = {"running", "waiting", "processing"}


@dataclass(frozen=True)
class NotificationDeleteTarget:
    notification_id: UUID
    source: str
    source_ref_id: str
    linked_thread_id: UUID | None
    linked_thread_status: str | None


def _as_uuid(value: UUID | str | None) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return UUID(text)
    except ValueError:
        return None


def _as_json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    return None


def _as_progress_json(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    out: dict[str, Any] = {}
    for key in ("current", "total", "stage", "label", "percentage"):
        if key in value:
            out[key] = value[key]
    return out or None


def _as_custom_slot_json(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    slot_type = str(value.get("type") or "none").strip()
    if slot_type not in {"none", "image"}:
        slot_type = "none"
    out: dict[str, Any] = {"type": slot_type}
    if slot_type == "image":
        url = value.get("url")
        if isinstance(url, str) and url.strip():
            out["url"] = url
        alt = value.get("alt")
        if isinstance(alt, str) and alt.strip():
            out["alt"] = alt
    return out


def _to_iso_utc(value: Any) -> Any:
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def map_run_status_to_notification_status(status: str | None) -> str:
    text = str(status or "").strip()
    if text in {"running", "processing"}:
        return "running"
    if text in {"waiting", "paused"}:
        return "pending"
    if text == "done":
        return "success"
    if text == "error":
        return "error"
    if text == "canceled":
        return "cancelled"
    return "running"


def message_from_notification_status(*, status: str, error: str | None = None) -> str:
    if status == "running":
        return "Processing..."
    if status == "pending":
        return "Needs confirmation"
    if status == "success":
        return "Completed"
    if status == "error":
        return error or "An error occurred"
    if status == "cancelled":
        return "Canceled"
    return "Processing..."


def default_journey_label(journey_kind: str | None) -> str:
    kind = str(journey_kind or "").strip()
    if kind == "manuscriptEdit":
        return "AI Manuscript Edit"
    if kind == "outlineEdit":
        return "AI Outline Edit"
    if kind == "storyObjectEdit":
        return "AI Edit"
    if kind == "objectTranslation":
        return "Object Translation"
    if kind == "imagePrompt":
        return "Image Prompt"
    if kind == "sceneImagePrompt":
        return "Scene Image Prompt"
    if kind == "messageTranslation":
        return "Message Translation"
    return "Journey"


def serialize_notification(row: NotificationModel) -> dict[str, Any]:
    progress = _as_progress_json(row.progress_json)
    custom_slot = _as_custom_slot_json(row.custom_slot_json) or {"type": "none"}
    meta = _as_json_object(row.meta_json)

    return {
        "id": str(row.id),
        "project_id": str(row.project_id),
        "source": row.source,
        "source_ref_id": row.source_ref_id,
        "thread_id": str(row.thread_id) if row.thread_id else None,
        "status": row.status,
        "label": row.label,
        "message": row.message,
        "warning": row.warning,
        "progress": progress,
        "custom_slot": custom_slot,
        "meta": meta,
        "is_read": bool(row.is_read),
        "created_at": _to_iso_utc(row.created_at),
        "updated_at": _to_iso_utc(row.updated_at),
    }


def upsert_notification(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    source: str,
    source_ref_id: str,
    thread_id: UUID | None = None,
    status: str,
    label: str,
    message: str,
    warning: str | None = None,
    progress: dict[str, Any] | None = None,
    custom_slot: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
) -> NotificationModel:
    normalized_source = str(source or "").strip()
    if normalized_source not in NOTIFICATION_SOURCE_VALUES:
        raise ValueError(f"Unsupported notification source: {normalized_source}")

    normalized_status = str(status or "").strip()
    if normalized_status not in NOTIFICATION_STATUS_VALUES:
        raise ValueError(f"Unsupported notification status: {normalized_status}")

    normalized_ref = str(source_ref_id or "").strip()
    if not normalized_ref:
        raise ValueError("source_ref_id is required")

    normalized_label = str(label or "").strip() or "Notification"
    normalized_message = str(message or "").strip() or "Processing..."
    normalized_warning = warning.strip() if isinstance(warning, str) and warning.strip() else None
    normalized_progress = _as_progress_json(progress)
    normalized_custom_slot = _as_custom_slot_json(custom_slot) or {"type": "none"}
    normalized_meta = _as_json_object(meta)

    row = (
        db.query(NotificationModel)
        .filter(
            NotificationModel.user_id == user_id,
            NotificationModel.project_id == project_id,
            NotificationModel.source == normalized_source,
            NotificationModel.source_ref_id == normalized_ref,
        )
        .first()
    )

    if row is None:
        row = NotificationModel(
            user_id=user_id,
            project_id=project_id,
            source=normalized_source,
            source_ref_id=normalized_ref,
            thread_id=thread_id,
            status=normalized_status,
            label=normalized_label,
            message=normalized_message,
            warning=normalized_warning,
            progress_json=normalized_progress,
            custom_slot_json=normalized_custom_slot,
            meta_json=normalized_meta,
            is_read=False,
        )
        db.add(row)
        db.flush()
        apply_project_usage_delta(
            db,
            user_id=user_id,
            project_id=project_id,
            delta=build_notification_delta(None, snapshot_notification_row(row)),
            enforce_quota=False,
        )
        return row

    before = snapshot_notification_row(row)
    next_thread_id = thread_id if thread_id is not None else row.thread_id
    changed = any(
        [
            row.thread_id != next_thread_id,
            row.status != normalized_status,
            row.label != normalized_label,
            row.message != normalized_message,
            row.warning != normalized_warning,
            row.progress_json != normalized_progress,
            row.custom_slot_json != normalized_custom_slot,
            row.meta_json != normalized_meta,
        ]
    )

    row.thread_id = next_thread_id
    row.status = normalized_status
    row.label = normalized_label
    row.message = normalized_message
    row.warning = normalized_warning
    row.progress_json = normalized_progress
    row.custom_slot_json = normalized_custom_slot
    row.meta_json = normalized_meta
    row.updated_at = datetime.utcnow()

    if changed:
        row.is_read = False

    db.flush()
    apply_project_usage_delta(
        db,
        user_id=user_id,
        project_id=project_id,
        delta=build_notification_delta(before, snapshot_notification_row(row)),
        enforce_quota=False,
    )
    return row


def list_notifications(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    limit: int,
    offset: int,
    include_read: bool,
    source: str | None,
) -> tuple[list[NotificationModel], int]:
    q = db.query(NotificationModel).filter(
        NotificationModel.user_id == user_id,
        NotificationModel.project_id == project_id,
    )

    if not include_read:
        q = q.filter(NotificationModel.is_read == False)  # noqa: E712

    if source:
        q = q.filter(NotificationModel.source == source)

    total = int(q.with_entities(func.count(NotificationModel.id)).scalar() or 0)
    rows = (
        q.order_by(NotificationModel.updated_at.desc(), NotificationModel.id.desc())
        .offset(max(offset, 0))
        .limit(max(min(limit, 200), 1))
        .all()
    )
    return rows, total


def get_notifications_by_ids(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    notification_ids: Iterable[UUID | str],
) -> list[NotificationModel]:
    ordered_ids: list[UUID] = []
    seen_ids: set[UUID] = set()
    for raw_id in notification_ids:
        notification_id = _as_uuid(raw_id)
        if notification_id is None or notification_id in seen_ids:
            continue
        seen_ids.add(notification_id)
        ordered_ids.append(notification_id)

    if not ordered_ids:
        return []

    rows = (
        db.query(NotificationModel)
        .filter(
            NotificationModel.user_id == user_id,
            NotificationModel.project_id == project_id,
            NotificationModel.id.in_(ordered_ids),
        )
        .all()
    )
    rows_by_id = {
        row.id: row
        for row in rows
        if isinstance(getattr(row, "id", None), UUID)
    }
    return [rows_by_id[notification_id] for notification_id in ordered_ids if notification_id in rows_by_id]


def mark_notifications_read(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    notification_ids: Iterable[str],
    mark_all: bool,
) -> list[str]:
    q = db.query(NotificationModel).filter(
        NotificationModel.user_id == user_id,
        NotificationModel.project_id == project_id,
    )

    if mark_all:
        rows = q.filter(NotificationModel.is_read == False).all()  # noqa: E712
    else:
        uuids = [u for u in (_as_uuid(raw) for raw in notification_ids) if u is not None]
        if not uuids:
            return []
        rows = q.filter(NotificationModel.id.in_(uuids)).all()

    if not rows:
        return []

    now = datetime.utcnow()
    updated_ids: list[str] = []
    for row in rows:
        if row.is_read:
            continue
        row.is_read = True
        row.updated_at = now
        updated_ids.append(str(row.id))

    db.flush()
    return updated_ids


def _dedupe_uuid_values(values: Iterable[UUID | None]) -> list[UUID]:
    ordered: list[UUID] = []
    seen: set[UUID] = set()
    for value in values:
        if not isinstance(value, UUID) or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _resolve_linked_journey_thread(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    row: NotificationModel,
) -> Thread | None:
    if row.source != "journey":
        return None

    if row.thread_id is not None:
        thread = (
            db.query(Thread)
            .filter(
                Thread.id == row.thread_id,
                Thread.user_id == user_id,
                Thread.project_id == project_id,
                Thread.thread_type == "journey",
            )
            .first()
        )
        if thread is not None:
            return thread

    fallback_thread_id = _as_uuid(row.source_ref_id)
    if fallback_thread_id is None or fallback_thread_id == row.thread_id:
        return None

    return (
        db.query(Thread)
        .filter(
            Thread.id == fallback_thread_id,
            Thread.user_id == user_id,
            Thread.project_id == project_id,
            Thread.thread_type == "journey",
        )
        .first()
    )


def list_notification_delete_targets(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    notification_id: UUID | None = None,
    only_read: bool = False,
) -> list[NotificationDeleteTarget]:
    q = db.query(NotificationModel).filter(
        NotificationModel.user_id == user_id,
        NotificationModel.project_id == project_id,
    )
    if notification_id is not None:
        q = q.filter(NotificationModel.id == notification_id)
    if only_read:
        q = q.filter(NotificationModel.is_read == True)  # noqa: E712

    rows = q.all()
    out: list[NotificationDeleteTarget] = []
    for row in rows:
        thread = _resolve_linked_journey_thread(
            db,
            user_id=user_id,
            project_id=project_id,
            row=row,
        )
        out.append(
            NotificationDeleteTarget(
                notification_id=row.id,
                source=row.source,
                source_ref_id=row.source_ref_id,
                linked_thread_id=(thread.id if thread is not None else None),
                linked_thread_status=(thread.status if thread is not None else None),
            )
        )
    return out


def collect_notification_delete_deltas(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    targets: Iterable[NotificationDeleteTarget],
) -> list[StorageUsageDelta]:
    target_list = list(targets)
    notification_ids = [target.notification_id for target in target_list]
    thread_ids = _dedupe_uuid_values(target.linked_thread_id for target in target_list)

    notification_rows = get_notifications_by_ids(
        db,
        user_id=user_id,
        project_id=project_id,
        notification_ids=notification_ids,
    )
    thread_rows = (
        db.query(Thread)
        .filter(
            Thread.user_id == user_id,
            Thread.project_id == project_id,
            Thread.thread_type == "journey",
            Thread.id.in_(thread_ids),
        )
        .all()
        if thread_ids
        else []
    )
    run_rows = (
        db.query(RunModel)
        .filter(RunModel.thread_id.in_(thread_ids))
        .all()
        if thread_ids
        else []
    )
    image_run_rows = (
        db.query(ImageRunModel)
        .filter(ImageRunModel.thread_id.in_(thread_ids))
        .all()
        if thread_ids
        else []
    )
    message_rows = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.thread_id.in_(thread_ids))
        .all()
        if thread_ids
        else []
    )
    tool_call_rows = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.thread_id.in_(thread_ids))
        .all()
        if thread_ids
        else []
    )

    deltas = [build_notification_delta(snapshot_notification_row(row), None) for row in notification_rows]
    deltas.extend(build_thread_delta(snapshot_thread_row(row), None) for row in thread_rows)
    deltas.extend(build_run_delta(snapshot_run_row(row), None) for row in run_rows)
    deltas.extend(build_image_run_delta(snapshot_image_run_row(row), None) for row in image_run_rows)
    deltas.extend(build_run_message_delta(snapshot_run_message_row(row), None) for row in message_rows)
    deltas.extend(build_tool_call_delta(snapshot_tool_call_row(row), None) for row in tool_call_rows)
    return deltas


def delete_notification_targets(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    targets: Iterable[NotificationDeleteTarget],
) -> tuple[list[str], list[str]]:
    deleted_notification_ids: list[str] = []
    deleted_thread_ids: list[str] = []
    unique_thread_ids: list[UUID] = []
    seen_thread_ids: set[UUID] = set()

    target_list = list(targets)
    for target in target_list:
        row = (
            db.query(NotificationModel)
            .filter(
                NotificationModel.id == target.notification_id,
                NotificationModel.user_id == user_id,
                NotificationModel.project_id == project_id,
            )
            .first()
        )
        if row is None:
            continue
        db.delete(row)
        deleted_notification_ids.append(str(target.notification_id))

        thread_id = target.linked_thread_id
        if thread_id is None or thread_id in seen_thread_ids:
            continue
        seen_thread_ids.add(thread_id)
        unique_thread_ids.append(thread_id)

    for thread_id in unique_thread_ids:
        thread = (
            db.query(Thread)
            .filter(
                Thread.id == thread_id,
                Thread.user_id == user_id,
                Thread.project_id == project_id,
                Thread.thread_type == "journey",
            )
            .first()
        )
        if thread is None:
            continue
        db.delete(thread)
        deleted_thread_ids.append(str(thread_id))

    db.flush()
    return deleted_notification_ids, deleted_thread_ids


def sync_journey_notification_from_runtime_status(
    db: Session,
    *,
    thread_id: UUID | str,
    status: str,
    error: str | None,
) -> NotificationModel | None:
    thread_uuid = _as_uuid(thread_id)
    if thread_uuid is None:
        return None

    thread = db.query(Thread).filter(Thread.id == thread_uuid).first()
    if thread is None:
        return None
    if thread.thread_type != "journey":
        return None

    mapped_status = map_run_status_to_notification_status(status)
    message = message_from_notification_status(status=mapped_status, error=error)

    existing = (
        db.query(NotificationModel)
        .filter(
            NotificationModel.user_id == thread.user_id,
            NotificationModel.project_id == thread.project_id,
            NotificationModel.source == "journey",
            NotificationModel.source_ref_id == str(thread.id),
        )
        .first()
    )
    existing_meta = _as_json_object(existing.meta_json) if existing is not None else None
    merged_meta = {
        "thread_id": str(thread.id),
        "journey_kind": thread.journey_kind,
        "project_id": str(thread.project_id),
    }
    if existing_meta:
        merged_meta = {**existing_meta, **merged_meta}

    row = upsert_notification(
        db,
        user_id=thread.user_id,
        project_id=thread.project_id,
        source="journey",
        source_ref_id=str(thread.id),
        thread_id=thread.id,
        status=mapped_status,
        label=(existing.label if existing is not None else default_journey_label(thread.journey_kind)),
        message=message,
        warning=error if mapped_status == "error" else None,
        progress=None,
        custom_slot={"type": "none"},
        meta=merged_meta,
    )
    db.flush()
    return row

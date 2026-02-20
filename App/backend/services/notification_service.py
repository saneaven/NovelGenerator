from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.db_models import NotificationModel, Thread


NOTIFICATION_SOURCE_VALUES = {"journey", "imageTask"}
NOTIFICATION_STATUS_VALUES = {"running", "pending", "success", "error", "cancelled"}


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
    if kind == "objectEdit":
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
        return row

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


def delete_notification(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    notification_id: UUID,
) -> NotificationModel | None:
    row = (
        db.query(NotificationModel)
        .filter(
            NotificationModel.id == notification_id,
            NotificationModel.user_id == user_id,
            NotificationModel.project_id == project_id,
        )
        .first()
    )
    if row is None:
        return None
    db.delete(row)
    db.flush()
    return row


def delete_all_notifications(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    only_read: bool,
) -> list[str]:
    q = db.query(NotificationModel).filter(
        NotificationModel.user_id == user_id,
        NotificationModel.project_id == project_id,
    )
    if only_read:
        q = q.filter(NotificationModel.is_read == True)  # noqa: E712

    rows = q.all()
    ids = [str(row.id) for row in rows]
    for row in rows:
        db.delete(row)
    db.flush()
    return ids


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

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.db_models import (
    ImageRunModel,
    Journey,
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

NOTIFICATION_SOURCE_KIND_VALUES = {"journey", "imageRun", "system"}
JOURNEY_NOTIFICATION_STATUS_VALUES = {"running", "waiting", "processing", "paused", "done", "error", "canceled"}
IMAGE_RUN_NOTIFICATION_STATUS_VALUES = {"queued", "running", "review", "applying", "applied", "rejected", "failed", "canceled"}
SYSTEM_NOTIFICATION_STATUS_VALUES = {"running", "done", "error", "canceled"}
NOTIFICATION_ALLOWED_STATUSES_BY_SOURCE = {
    "journey": JOURNEY_NOTIFICATION_STATUS_VALUES,
    "imageRun": IMAGE_RUN_NOTIFICATION_STATUS_VALUES,
    "system": SYSTEM_NOTIFICATION_STATUS_VALUES,
}
NOTIFICATION_STATUS_VALUES = set().union(*NOTIFICATION_ALLOWED_STATUSES_BY_SOURCE.values())
NOTIFICATION_TARGET_KIND_VALUES = {"none", "project", "thread", "journey"}
ACTIVE_THREAD_DELETE_STATUSES = {"running", "waiting", "processing"}


@dataclass(frozen=True)
class NotificationDeleteRow:
    id: str
    project_id: str | None


@dataclass(frozen=True)
class NotificationSourceSnapshot:
    user_id: UUID
    project_id: UUID | None
    source_kind: str
    source_id: str
    status: str
    label: str
    message: str
    important: bool
    target: dict[str, Any]
    warning: str | None = None
    progress: dict[str, Any] | None = None
    custom_slot: dict[str, Any] | None = None
    meta: dict[str, Any] | None = None


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
    return out or {"type": "none"}


def _normalize_target_json(
    value: Any,
    *,
    project_id: UUID | str | None = None,
) -> dict[str, Any]:
    base_project_id = str(project_id) if project_id is not None else None
    if not isinstance(value, dict):
        return {"kind": "none"}

    kind = str(value.get("kind") or "none").strip()
    if kind not in NOTIFICATION_TARGET_KIND_VALUES:
        kind = "none"

    project_id_value = value.get("project_id")
    if project_id_value is None and kind in {"project", "thread", "journey"}:
        project_id_value = base_project_id
    project_id_text = str(project_id_value).strip() if project_id_value is not None else None

    if kind == "project":
        return {
            "kind": "project",
            "project_id": project_id_text,
        } if project_id_text else {"kind": "none"}

    if kind == "thread":
        thread_id_value = value.get("thread_id")
        thread_id_text = str(thread_id_value).strip() if thread_id_value is not None else None
        if project_id_text and thread_id_text:
            return {
                "kind": "thread",
                "project_id": project_id_text,
                "thread_id": thread_id_text,
            }
        return {"kind": "none"}

    if kind == "journey":
        journey_id_value = value.get("journey_id")
        journey_id_text = str(journey_id_value).strip() if journey_id_value is not None else None
        thread_id_value = value.get("thread_id")
        thread_id_text = str(thread_id_value).strip() if thread_id_value is not None else None
        if project_id_text and journey_id_text:
            out = {
                "kind": "journey",
                "project_id": project_id_text,
                "journey_id": journey_id_text,
            }
            if thread_id_text:
                out["thread_id"] = thread_id_text
            return out
        return {"kind": "none"}

    return {"kind": "none"}


def _to_iso_utc(value: Any) -> Any:
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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


def validate_notification_snapshot(snapshot: NotificationSourceSnapshot) -> None:
    normalized_source_kind = str(snapshot.source_kind or "").strip()
    if normalized_source_kind not in NOTIFICATION_SOURCE_KIND_VALUES:
        raise ValueError(f"Unsupported notification source kind: {normalized_source_kind}")

    normalized_status = str(snapshot.status or "").strip()
    allowed = NOTIFICATION_ALLOWED_STATUSES_BY_SOURCE.get(normalized_source_kind, set())
    if normalized_status not in allowed:
        raise ValueError(
            f"Unsupported notification status '{normalized_status}' for source kind '{normalized_source_kind}'"
        )


def _journey_message_for_status(*, status: str, error: str | None = None) -> str:
    if status == "running":
        return "Running..."
    if status == "processing":
        return "Applying changes..."
    if status == "waiting":
        return "Needs confirmation"
    if status == "paused":
        return "Paused"
    if status == "done":
        return "Completed"
    if status == "error":
        return error or "An error occurred"
    if status == "canceled":
        return "Canceled"
    return "Running..."


def build_journey_notification_snapshot(
    *,
    journey: Journey,
    thread: Thread,
    run: RunModel,
    error: str | None,
) -> NotificationSourceSnapshot:
    status = str(run.status or "").strip() or "running"
    return NotificationSourceSnapshot(
        user_id=journey.user_id,
        project_id=journey.project_id,
        source_kind="journey",
        source_id=str(journey.id),
        status=status,
        label=str(journey.display_label or "").strip() or default_journey_label(journey.kind),
        message=_journey_message_for_status(status=status, error=error),
        warning=error if status == "error" else None,
        progress=None,
        custom_slot={"type": "none"},
        target={
            "kind": "journey",
            "project_id": str(journey.project_id),
            "journey_id": str(journey.id),
            "thread_id": str(thread.id),
        },
        meta={
            "journey_id": str(journey.id),
            "thread_id": str(thread.id),
            "run_id": str(run.id),
            "journey_kind": journey.kind,
            "project_id": str(journey.project_id),
        },
        important=status in {"waiting", "error"},
    )


def _image_run_message_for_row(row: ImageRunModel) -> str:
    if row.status == "queued":
        return "Queued"
    if row.status == "review":
        return "Preview ready"
    if row.status == "applying":
        return "Applying..."
    if row.status == "applied":
        return "Completed"
    if row.status == "rejected":
        return "Rejected"
    if row.status == "failed":
        return row.error_message or "Image generation failed"
    if row.status == "canceled":
        return "Canceled"
    if row.stage == "preparing":
        return "Preparing..."
    if row.stage == "generating":
        return "Generating..."
    if row.stage == "saving":
        return "Saving..."
    if row.stage == "binding":
        return "Binding..."
    return "Running..."


def build_image_run_notification_snapshot(
    *,
    row: ImageRunModel,
    serialized_payload: dict[str, Any],
    custom_slot: dict[str, Any] | None = None,
) -> NotificationSourceSnapshot:
    request_snapshot = serialized_payload.get("request_snapshot")
    if not isinstance(request_snapshot, dict):
        request_snapshot = {}
    tool_call_id = request_snapshot.get("tool_call_id")
    normalized_tool_call_id = str(tool_call_id).strip() if tool_call_id is not None else None
    thread_id = str(row.thread_id) if row.thread_id is not None else None
    return NotificationSourceSnapshot(
        user_id=row.user_id,
        project_id=row.project_id,
        source_kind="imageRun",
        source_id=str(row.id),
        status=str(row.status),
        label=str(request_snapshot.get("label") or "Image generation"),
        message=_image_run_message_for_row(row),
        warning=row.error_message if row.status == "failed" else None,
        progress={
            "stage": row.stage,
            "label": _image_run_message_for_row(row),
        }
        if row.status in {"queued", "running", "applying"}
        else None,
        custom_slot=custom_slot or {"type": "none"},
        target={
            "kind": "thread" if thread_id else "project",
            "project_id": str(row.project_id),
            "thread_id": thread_id,
        },
        meta={
            "image_run_id": str(row.id),
            "thread_id": thread_id,
            "tool_call_id": normalized_tool_call_id,
            "preview_asset_id": serialized_payload.get("preview_asset_id"),
            "final_asset_id": serialized_payload.get("final_asset_id"),
            "review_mode": row.review_mode,
        },
        important=row.status in {"review", "failed"},
    )


def build_system_notification_snapshot(
    *,
    user_id: UUID,
    source_id: str,
    status: str,
    label: str,
    message: str,
    project_id: UUID | None = None,
    warning: str | None = None,
    progress: dict[str, Any] | None = None,
    custom_slot: dict[str, Any] | None = None,
    target: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
    important: bool = False,
) -> NotificationSourceSnapshot:
    return NotificationSourceSnapshot(
        user_id=user_id,
        project_id=project_id,
        source_kind="system",
        source_id=source_id,
        status=status,
        label=label,
        message=message,
        important=important,
        target=target or {"kind": "none"},
        warning=warning,
        progress=progress,
        custom_slot=custom_slot,
        meta=meta,
    )


def _serialize_source_payload(*, row: NotificationModel, meta: dict[str, Any] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "kind": row.source_kind,
        "id": str(row.source_id),
    }
    if row.source_kind == "journey":
        if isinstance(meta, dict) and meta.get("thread_id"):
            payload["thread_id"] = str(meta.get("thread_id")).strip()
        if isinstance(meta, dict) and meta.get("run_id"):
            payload["run_id"] = str(meta.get("run_id")).strip()
        if isinstance(meta, dict) and meta.get("journey_kind"):
            payload["journey_kind"] = str(meta.get("journey_kind")).strip()
    elif row.source_kind == "imageRun":
        if isinstance(meta, dict) and meta.get("thread_id"):
            payload["thread_id"] = str(meta.get("thread_id")).strip()
        if isinstance(meta, dict) and meta.get("tool_call_id"):
            payload["tool_call_id"] = str(meta.get("tool_call_id")).strip()
        if isinstance(meta, dict) and meta.get("review_mode"):
            payload["review_mode"] = str(meta.get("review_mode")).strip()
    return payload


def serialize_notification(row: NotificationModel) -> dict[str, Any]:
    progress = _as_progress_json(row.progress_json)
    custom_slot = _as_custom_slot_json(row.custom_slot_json)
    meta = _as_json_object(row.meta_json)
    target = _normalize_target_json(row.target_json, project_id=row.project_id)

    return {
        "id": str(row.id),
        "project_id": str(row.project_id) if row.project_id is not None else None,
        "source": _serialize_source_payload(row=row, meta=meta),
        "status": row.status,
        "label": row.label,
        "message": row.message,
        "warning": row.warning,
        "progress": progress,
        "custom_slot": custom_slot,
        "target": target,
        "meta": meta,
        "important": bool(row.important),
        "is_read": bool(row.is_read),
        "created_at": _to_iso_utc(row.created_at),
        "updated_at": _to_iso_utc(row.updated_at),
    }


def _apply_notification_storage_delta(
    db: Session,
    *,
    user_id: UUID,
    before_project_id: UUID | None,
    after_project_id: UUID | None,
    before_snapshot: object | None,
    after_snapshot: object | None,
) -> None:
    if before_project_id == after_project_id:
        if after_project_id is not None:
            apply_project_usage_delta(
                db,
                user_id=user_id,
                project_id=after_project_id,
                delta=build_notification_delta(before_snapshot, after_snapshot),
                enforce_quota=False,
            )
        return

    if before_project_id is not None:
        apply_project_usage_delta(
            db,
            user_id=user_id,
            project_id=before_project_id,
            delta=build_notification_delta(before_snapshot, None),
            enforce_quota=False,
        )

    if after_project_id is not None:
        apply_project_usage_delta(
            db,
            user_id=user_id,
            project_id=after_project_id,
            delta=build_notification_delta(None, after_snapshot),
            enforce_quota=False,
        )


def upsert_notification_source(
    db: Session,
    *,
    snapshot: NotificationSourceSnapshot,
) -> NotificationModel:
    validate_notification_snapshot(snapshot)
    normalized_source_kind = str(snapshot.source_kind or "").strip()
    normalized_source_id = str(snapshot.source_id or "").strip()
    if not normalized_source_id:
        raise ValueError("Notification source_id is required")

    normalized_status = str(snapshot.status or "").strip()

    normalized_label = str(snapshot.label or "").strip() or "Notification"
    normalized_message = str(snapshot.message or "").strip() or "Processing..."
    normalized_warning = (
        snapshot.warning.strip()
        if isinstance(snapshot.warning, str) and snapshot.warning.strip()
        else None
    )
    normalized_progress = _as_progress_json(snapshot.progress)
    normalized_custom_slot = _as_custom_slot_json(snapshot.custom_slot)
    normalized_meta = _as_json_object(snapshot.meta)
    normalized_target = _normalize_target_json(snapshot.target, project_id=snapshot.project_id)
    normalized_important = bool(snapshot.important)

    row = (
        db.query(NotificationModel)
        .filter(
            NotificationModel.user_id == snapshot.user_id,
            NotificationModel.source_kind == normalized_source_kind,
            NotificationModel.source_id == normalized_source_id,
        )
        .first()
    )

    if row is None:
        row = NotificationModel(
            user_id=snapshot.user_id,
            project_id=snapshot.project_id,
            source_kind=normalized_source_kind,
            source_id=normalized_source_id,
            status=normalized_status,
            label=normalized_label,
            message=normalized_message,
            warning=normalized_warning,
            progress_json=normalized_progress,
            custom_slot_json=normalized_custom_slot,
            target_json=normalized_target,
            meta_json=normalized_meta,
            important=normalized_important,
            is_read=False,
        )
        db.add(row)
        db.flush()
        if snapshot.project_id is not None:
            apply_project_usage_delta(
                db,
                user_id=snapshot.user_id,
                project_id=snapshot.project_id,
                delta=build_notification_delta(None, snapshot_notification_row(row)),
                enforce_quota=False,
            )
        return row

    before_snapshot = snapshot_notification_row(row)
    before_project_id = row.project_id
    changed = any(
        [
            row.project_id != snapshot.project_id,
            row.source_kind != normalized_source_kind,
            row.source_id != normalized_source_id,
            row.status != normalized_status,
            row.label != normalized_label,
            row.message != normalized_message,
            row.warning != normalized_warning,
            row.progress_json != normalized_progress,
            row.custom_slot_json != normalized_custom_slot,
            row.target_json != normalized_target,
            row.meta_json != normalized_meta,
            row.important != normalized_important,
        ]
    )

    row.project_id = snapshot.project_id
    row.source_kind = normalized_source_kind
    row.source_id = normalized_source_id
    row.status = normalized_status
    row.label = normalized_label
    row.message = normalized_message
    row.warning = normalized_warning
    row.progress_json = normalized_progress
    row.custom_slot_json = normalized_custom_slot
    row.target_json = normalized_target
    row.meta_json = normalized_meta
    row.important = normalized_important
    row.updated_at = datetime.utcnow()

    if changed:
        row.is_read = False

    db.flush()
    _apply_notification_storage_delta(
        db,
        user_id=snapshot.user_id,
        before_project_id=before_project_id,
        after_project_id=row.project_id,
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_notification_row(row),
    )
    return row


def push_system_notification(
    db: Session,
    *,
    user_id: UUID,
    source_id: str,
    status: str,
    label: str,
    message: str,
    project_id: UUID | None = None,
    warning: str | None = None,
    progress: dict[str, Any] | None = None,
    custom_slot: dict[str, Any] | None = None,
    target: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
    important: bool = False,
) -> NotificationModel:
    return upsert_notification_source(
        db,
        snapshot=build_system_notification_snapshot(
            user_id=user_id,
            project_id=project_id,
            source_id=source_id,
            status=status,
            label=label,
            message=message,
            important=important,
            target=target,
            warning=warning,
            progress=progress,
            custom_slot=custom_slot,
            meta=meta,
        ),
    )


def list_notifications(
    db: Session,
    *,
    user_id: UUID,
    limit: int,
    offset: int,
    include_read: bool,
    kind: str | None = None,
    project_id: UUID | None = None,
    important: bool | None = None,
) -> tuple[list[NotificationModel], int]:
    q = db.query(NotificationModel).filter(NotificationModel.user_id == user_id)

    if project_id is not None:
        q = q.filter(NotificationModel.project_id == project_id)

    if not include_read:
        q = q.filter(NotificationModel.is_read == False)  # noqa: E712

    normalized_kind = str(kind).strip() if kind is not None else None
    if normalized_kind:
        q = q.filter(NotificationModel.source_kind == normalized_kind)

    if important is not None:
        q = q.filter(NotificationModel.important == bool(important))

    total = int(q.with_entities(func.count(NotificationModel.id)).scalar() or 0)
    rows = (
        q.order_by(
            NotificationModel.important.desc(),
            NotificationModel.is_read.asc(),
            NotificationModel.updated_at.desc(),
            NotificationModel.id.desc(),
        )
        .offset(max(offset, 0))
        .limit(max(min(limit, 200), 1))
        .all()
    )
    return rows, total


def get_notifications_by_ids(
    db: Session,
    *,
    user_id: UUID,
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
    notification_ids: Iterable[str],
    mark_all: bool,
    project_id: UUID | None = None,
) -> list[str]:
    q = db.query(NotificationModel).filter(NotificationModel.user_id == user_id)
    if project_id is not None:
        q = q.filter(NotificationModel.project_id == project_id)

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


def collect_notification_delete_deltas(
    db: Session,
    *,
    user_id: UUID,
    notification_ids: Iterable[UUID | str],
) -> dict[UUID, list[StorageUsageDelta]]:
    rows = get_notifications_by_ids(db, user_id=user_id, notification_ids=notification_ids)
    deltas_by_project: dict[UUID, list[StorageUsageDelta]] = {}
    for row in rows:
        if row.project_id is None:
            continue
        deltas_by_project.setdefault(row.project_id, []).append(
            build_notification_delta(snapshot_notification_row(row), None)
        )
    return deltas_by_project


def delete_notifications(
    db: Session,
    *,
    user_id: UUID,
    notification_ids: Iterable[UUID | str] | None = None,
    only_read: bool = False,
) -> list[NotificationDeleteRow]:
    if notification_ids is not None:
        rows = get_notifications_by_ids(db, user_id=user_id, notification_ids=notification_ids)
    else:
        q = db.query(NotificationModel).filter(NotificationModel.user_id == user_id)
        if only_read:
            q = q.filter(NotificationModel.is_read == True)  # noqa: E712
        rows = q.all()

    deleted_rows: list[NotificationDeleteRow] = []
    for row in rows:
        deleted_rows.append(
            NotificationDeleteRow(
                id=str(row.id),
                project_id=str(row.project_id) if row.project_id is not None else None,
            )
        )
        db.delete(row)
    db.flush()
    return deleted_rows


def delete_notification_source(
    db: Session,
    *,
    user_id: UUID,
    source_kind: str,
    source_id: UUID | str,
) -> NotificationDeleteRow | None:
    normalized_source_kind = str(source_kind or "").strip()
    normalized_source_id = str(source_id or "").strip()
    if normalized_source_kind not in NOTIFICATION_SOURCE_KIND_VALUES or not normalized_source_id:
        return None

    row = (
        db.query(NotificationModel)
        .filter(
            NotificationModel.user_id == user_id,
            NotificationModel.source_kind == normalized_source_kind,
            NotificationModel.source_id == normalized_source_id,
        )
        .first()
    )
    if row is None:
        return None

    deleted_row = NotificationDeleteRow(
        id=str(row.id),
        project_id=str(row.project_id) if row.project_id is not None else None,
    )
    db.delete(row)
    db.flush()
    return deleted_row


def _dedupe_uuid_values(values: Iterable[UUID | None]) -> list[UUID]:
    ordered: list[UUID] = []
    seen: set[UUID] = set()
    for value in values:
        if not isinstance(value, UUID) or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _load_threads_for_delete(
    db: Session,
    *,
    user_id: UUID,
    thread_ids: Iterable[UUID | None],
    project_id: UUID | None = None,
    thread_type: str | None = None,
) -> list[Thread]:
    ordered_ids = _dedupe_uuid_values(thread_ids)
    if not ordered_ids:
        return []

    q = db.query(Thread).filter(
        Thread.user_id == user_id,
        Thread.id.in_(ordered_ids),
    )
    if project_id is not None:
        q = q.filter(Thread.project_id == project_id)
    if thread_type is not None:
        q = q.filter(Thread.thread_type == thread_type)

    rows = q.all()
    rows_by_id = {
        row.id: row
        for row in rows
        if isinstance(getattr(row, "id", None), UUID)
    }
    return [rows_by_id[thread_id] for thread_id in ordered_ids if thread_id in rows_by_id]


def collect_thread_delete_deltas(
    db: Session,
    *,
    user_id: UUID,
    thread_ids: Iterable[UUID | None],
    project_id: UUID | None = None,
    thread_type: str | None = None,
) -> dict[UUID, list[StorageUsageDelta]]:
    thread_rows = _load_threads_for_delete(
        db,
        user_id=user_id,
        thread_ids=thread_ids,
        project_id=project_id,
        thread_type=thread_type,
    )
    if not thread_rows:
        return {}

    ordered_ids = [row.id for row in thread_rows]
    project_id_by_thread_id = {row.id: row.project_id for row in thread_rows}
    deltas_by_project: dict[UUID, list[StorageUsageDelta]] = {}

    def _append(thread_id: UUID, delta: StorageUsageDelta) -> None:
        target_project_id = project_id_by_thread_id.get(thread_id)
        if target_project_id is None:
            return
        deltas_by_project.setdefault(target_project_id, []).append(delta)

    for row in thread_rows:
        _append(row.id, build_thread_delta(snapshot_thread_row(row), None))

    run_rows = db.query(RunModel).filter(RunModel.thread_id.in_(ordered_ids)).all()
    for row in run_rows:
        if isinstance(getattr(row, "thread_id", None), UUID):
            _append(row.thread_id, build_run_delta(snapshot_run_row(row), None))

    image_run_rows = db.query(ImageRunModel).filter(ImageRunModel.thread_id.in_(ordered_ids)).all()
    for row in image_run_rows:
        if isinstance(getattr(row, "thread_id", None), UUID):
            _append(row.thread_id, build_image_run_delta(snapshot_image_run_row(row), None))

    message_rows = db.query(RunMessageModel).filter(RunMessageModel.thread_id.in_(ordered_ids)).all()
    for row in message_rows:
        if isinstance(getattr(row, "thread_id", None), UUID):
            _append(row.thread_id, build_run_message_delta(snapshot_run_message_row(row), None))

    tool_call_rows = db.query(RunToolCallModel).filter(RunToolCallModel.thread_id.in_(ordered_ids)).all()
    for row in tool_call_rows:
        if isinstance(getattr(row, "thread_id", None), UUID):
            _append(row.thread_id, build_tool_call_delta(snapshot_tool_call_row(row), None))

    return deltas_by_project


def delete_threads(
    db: Session,
    *,
    user_id: UUID,
    thread_ids: Iterable[UUID | None],
    project_id: UUID | None = None,
    thread_type: str | None = None,
) -> dict[UUID, list[str]]:
    thread_rows = _load_threads_for_delete(
        db,
        user_id=user_id,
        thread_ids=thread_ids,
        project_id=project_id,
        thread_type=thread_type,
    )
    deleted_ids_by_project: dict[UUID, list[str]] = {}
    for row in thread_rows:
        deleted_ids_by_project.setdefault(row.project_id, []).append(str(row.id))
        db.delete(row)

    db.flush()
    return deleted_ids_by_project


def list_notifications_for_thread_ids(
    db: Session,
    *,
    user_id: UUID,
    thread_ids: Iterable[UUID | str | None],
    project_id: UUID | None = None,
) -> list[NotificationModel]:
    thread_id_texts = {str(thread_id) for thread_id in thread_ids if thread_id is not None}
    if not thread_id_texts:
        return []

    q = db.query(NotificationModel).filter(NotificationModel.user_id == user_id)
    if project_id is not None:
        q = q.filter(NotificationModel.project_id == project_id)

    rows = q.all()
    out: list[NotificationModel] = []
    for row in rows:
        target = _normalize_target_json(row.target_json, project_id=row.project_id)
        target_thread_id = str(target.get("thread_id") or "").strip()
        if target_thread_id and target_thread_id in thread_id_texts:
            out.append(row)
    return out


def collect_notification_delete_deltas_for_thread_ids(
    db: Session,
    *,
    user_id: UUID,
    thread_ids: Iterable[UUID | str | None],
    project_id: UUID | None = None,
) -> dict[UUID, list[StorageUsageDelta]]:
    rows = list_notifications_for_thread_ids(
        db,
        user_id=user_id,
        thread_ids=thread_ids,
        project_id=project_id,
    )
    deltas_by_project: dict[UUID, list[StorageUsageDelta]] = {}
    for row in rows:
        if row.project_id is None:
            continue
        deltas_by_project.setdefault(row.project_id, []).append(
            build_notification_delta(snapshot_notification_row(row), None)
        )
    return deltas_by_project


def delete_notifications_for_thread_ids(
    db: Session,
    *,
    user_id: UUID,
    thread_ids: Iterable[UUID | str | None],
    project_id: UUID | None = None,
) -> list[NotificationDeleteRow]:
    rows = list_notifications_for_thread_ids(
        db,
        user_id=user_id,
        thread_ids=thread_ids,
        project_id=project_id,
    )
    deleted_rows: list[NotificationDeleteRow] = []
    for row in rows:
        deleted_rows.append(
            NotificationDeleteRow(
                id=str(row.id),
                project_id=str(row.project_id) if row.project_id is not None else None,
            )
        )
        db.delete(row)
    db.flush()
    return deleted_rows

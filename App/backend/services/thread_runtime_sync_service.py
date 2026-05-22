from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import NotificationModel, RunModel, RunToolCallModel, Thread
from .notification_service import serialize_notification
from .run_status_logic import derive_run_status
from .thread_parent_runtime_service import apply_parent_runtime_snapshot

if TYPE_CHECKING:
    from .runtime_event_dispatcher import RuntimeEventDispatcher


@dataclass(frozen=True)
class RuntimeSyncResult:
    run: RunModel | None
    thread: Thread | None
    notification: NotificationModel | None
    status: str | None


def _latest_run_for_thread(db: Session, *, thread_id: UUID) -> RunModel | None:
    return (
        db.query(RunModel)
        .filter(RunModel.thread_id == thread_id)
        .order_by(RunModel.run_seq.desc())
        .first()
    )


def sync_run_thread_status(db: Session, *, run_id: UUID) -> RuntimeSyncResult:
    db.flush()
    run = db.query(RunModel).filter(RunModel.id == run_id).first()
    if run is None:
        return RuntimeSyncResult(run=None, thread=None, notification=None, status=None)

    thread = run.thread
    if thread is None:
        return RuntimeSyncResult(run=run, thread=None, notification=None, status=run.status)

    tool_call_statuses = [
        status
        for (status,) in db.query(RunToolCallModel.status)
        .filter(RunToolCallModel.run_id == run_id)
        .all()
    ]
    next_status = derive_run_status(current_status=run.status, tool_call_statuses=tool_call_statuses)
    if next_status is not None:
        run.status = next_status
        latest_run = _latest_run_for_thread(db, thread_id=thread.id)
        if latest_run is not None and latest_run.id == run.id:
            thread.status = next_status

    notification = None
    if isinstance(getattr(thread, "thread_type", None), str):
        notification = apply_parent_runtime_snapshot(
            db,
            thread=thread,
            run=run,
            error=run.error if run.status == "error" else None,
        )
    db.flush()
    return RuntimeSyncResult(run=run, thread=thread, notification=notification, status=run.status)


def sync_explicit_run_thread_status(
    db: Session,
    *,
    run: RunModel,
    thread: Thread | None,
    error: str | None,
) -> RuntimeSyncResult:
    notification = None
    if thread is not None and isinstance(getattr(thread, "thread_type", None), str):
        notification = apply_parent_runtime_snapshot(
            db,
            thread=thread,
            run=run,
            error=error,
        )
    db.flush()
    return RuntimeSyncResult(run=run, thread=thread, notification=notification, status=run.status)


def refresh_runtime_sync_result(db: Session, *, result: RuntimeSyncResult | None) -> RuntimeSyncResult | None:
    if result is None:
        return None

    # Rehydrate ORM instances after commit so async emitters can safely read
    # their scalar fields after this session has been closed.
    if result.run is not None:
        db.refresh(result.run)
    if result.thread is not None:
        db.refresh(result.thread)
    if result.notification is not None:
        db.refresh(result.notification)
    return result


async def emit_runtime_sync_events(
    dispatcher: "RuntimeEventDispatcher",
    *,
    result: RuntimeSyncResult,
    emit_run_status: bool = True,
    extra_status_data: dict[str, Any] | None = None,
) -> None:
    if emit_run_status and result.run is not None and result.thread is not None:
        emit_runtime_event = getattr(dispatcher, "emit_runtime_event", None)
        user_id = getattr(result.run, "user_id", None) or getattr(result.thread, "user_id", None)
        project_id = getattr(result.run, "project_id", None) or getattr(result.thread, "project_id", None)
        thread_id = getattr(result.thread, "id", None)
        if callable(emit_runtime_event) and user_id is not None and project_id is not None and thread_id is not None:
            payload = {
                "run_id": str(result.run.id),
                "status": result.run.status,
                "error": result.run.error,
            }
            if extra_status_data:
                payload.update(extra_status_data)
            await emit_runtime_event(
                user_id=user_id,
                project_id=project_id,
                thread_id=thread_id,
                event_name="run:status",
                data=payload,
            )
    if result.notification is not None:
        emit_project_event = getattr(dispatcher, "emit_project_event", None)
        project_id = getattr(result.notification, "project_id", None)
        user_id = getattr(result.notification, "user_id", None)
        if callable(emit_project_event) and project_id is not None and user_id is not None:
            await emit_project_event(
                user_id=user_id,
                project_id=project_id,
                event_name="notification:upsert",
                data=serialize_notification(result.notification),
            )

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import ImageRunModel, NotificationModel, User
from ..schemas.notifications import (
    DeleteAllNotificationsRequest,
    DeleteAllNotificationsResponse,
    MarkNotificationsReadRequest,
    MarkNotificationsReadResponse,
    NotificationListResponse,
    NotificationResponse,
)
from ..services.notification_service import (
    ACTIVE_THREAD_DELETE_STATUSES,
    NOTIFICATION_SOURCE_VALUES,
    NotificationDeleteTarget,
    delete_notification_targets,
    list_notification_delete_targets,
    list_notifications,
    mark_notifications_read,
    serialize_notification,
)
from ..services.ownership import require_owned_project
from ..services.run_pipeline import run_pipeline
from ..services.runtime_event_dispatcher import runtime_event_dispatcher
from ..services.storage_usage_service import (
    apply_project_usage_deltas,
    build_image_run_delta,
    build_notification_delta,
    build_run_delta,
    build_run_message_delta,
    build_thread_delta,
    build_tool_call_delta,
    snapshot_notification_row,
    snapshot_rows,
    snapshot_image_run_row,
    snapshot_run_message_row,
    snapshot_run_row,
    snapshot_thread_row,
    snapshot_tool_call_row,
)


router = APIRouter(prefix="/api/v1", tags=["notifications"])


async def _cancel_linked_journey_threads_for_delete(
    *,
    targets: Iterable[NotificationDeleteTarget],
    user_id: UUID,
) -> None:
    seen: set[UUID] = set()
    for target in targets:
        thread_id = target.linked_thread_id
        if (
            thread_id is None
            or thread_id in seen
            or target.linked_thread_status not in ACTIVE_THREAD_DELETE_STATUSES
        ):
            continue
        seen.add(thread_id)
        await run_pipeline.cancel_run_for_delete(thread_id=thread_id, user_id=user_id)


def _collect_notification_delete_deltas(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    targets: Iterable[NotificationDeleteTarget],
):
    target_list = list(targets)
    notification_ids = [target.notification_id for target in target_list]
    thread_ids = list(
        {
            thread_id
            for thread_id in (target.linked_thread_id for target in target_list)
            if isinstance(thread_id, UUID)
        }
    )

    notification_rows = (
        db.query(NotificationModel)
        .filter(
            NotificationModel.user_id == user_id,
            NotificationModel.project_id == project_id,
            NotificationModel.id.in_(notification_ids),
        )
        .all()
        if notification_ids
        else []
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


@router.get("/projects/{project_id}/notifications", response_model=NotificationListResponse)
async def get_project_notifications(
    project_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    include_read: bool = Query(True),
    source: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)

    normalized_source = str(source).strip() if source is not None else None
    if normalized_source is not None and normalized_source not in NOTIFICATION_SOURCE_VALUES:
        raise HTTPException(status_code=422, detail=f"Unsupported source: {normalized_source}")

    rows, total = list_notifications(
        db,
        user_id=current_user.id,
        project_id=project_id,
        limit=limit,
        offset=offset,
        include_read=include_read,
        source=normalized_source,
    )

    return NotificationListResponse(
        items=[NotificationResponse(**serialize_notification(row)) for row in rows],
        total=total,
    )


@router.patch("/projects/{project_id}/notifications/read", response_model=MarkNotificationsReadResponse)
async def mark_project_notifications_read(
    project_id: UUID,
    payload: MarkNotificationsReadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)

    updated_ids = mark_notifications_read(
        db,
        user_id=current_user.id,
        project_id=project_id,
        notification_ids=payload.notification_ids,
        mark_all=payload.mark_all,
    )
    db.commit()

    if updated_ids:
        rows = (
            db.query(NotificationModel)
            .filter(NotificationModel.id.in_([UUID(x) for x in updated_ids]))
            .all()
        )
        for row in rows:
            await runtime_event_dispatcher.emit_project_event(
                project_id=project_id,
                event_name="notification:upsert",
                data=serialize_notification(row),
            )

    return MarkNotificationsReadResponse(updated=len(updated_ids), ids=updated_ids)


@router.delete("/projects/{project_id}/notifications/{notification_id}", status_code=204)
async def delete_project_notification(
    project_id: UUID,
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)

    targets = list_notification_delete_targets(
        db,
        user_id=current_user.id,
        project_id=project_id,
        notification_id=notification_id,
    )
    if not targets:
        raise HTTPException(status_code=404, detail="Notification not found")

    await _cancel_linked_journey_threads_for_delete(targets=targets, user_id=current_user.id)
    db.expire_all()

    deltas = _collect_notification_delete_deltas(
        db,
        user_id=current_user.id,
        project_id=project_id,
        targets=targets,
    )
    deleted_ids, deleted_thread_ids = delete_notification_targets(
        db,
        user_id=current_user.id,
        project_id=project_id,
        targets=targets,
    )
    if not deleted_ids:
        raise HTTPException(status_code=404, detail="Notification not found")

    target = targets[0]
    payload = {
        "id": deleted_ids[0],
        "source": target.source,
        "source_ref_id": target.source_ref_id,
    }
    apply_project_usage_deltas(
        db,
        user_id=current_user.id,
        project_id=project_id,
        deltas=deltas,
        enforce_quota=False,
    )
    db.commit()

    await runtime_event_dispatcher.emit_project_event(
        project_id=project_id,
        event_name="notification:delete",
        data=payload,
    )
    if deleted_thread_ids:
        await runtime_event_dispatcher.emit_project_event(
            project_id=project_id,
            event_name="thread:delete",
            data={"id": deleted_thread_ids[0]},
        )

    return Response(status_code=204)


@router.post("/projects/{project_id}/notifications/delete-all", response_model=DeleteAllNotificationsResponse)
async def delete_all_project_notifications(
    project_id: UUID,
    payload: DeleteAllNotificationsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)

    targets = list_notification_delete_targets(
        db,
        user_id=current_user.id,
        project_id=project_id,
        only_read=payload.only_read,
    )
    await _cancel_linked_journey_threads_for_delete(targets=targets, user_id=current_user.id)
    db.expire_all()

    deltas = _collect_notification_delete_deltas(
        db,
        user_id=current_user.id,
        project_id=project_id,
        targets=targets,
    )
    deleted_ids, deleted_thread_ids = delete_notification_targets(
        db,
        user_id=current_user.id,
        project_id=project_id,
        targets=targets,
    )
    apply_project_usage_deltas(
        db,
        user_id=current_user.id,
        project_id=project_id,
        deltas=deltas,
        enforce_quota=False,
    )
    db.commit()

    if deleted_ids:
        await runtime_event_dispatcher.emit_project_event(
            project_id=project_id,
            event_name="notification:bulk_delete",
            data={"ids": deleted_ids},
        )
    if deleted_thread_ids:
        await runtime_event_dispatcher.emit_project_event(
            project_id=project_id,
            event_name="thread:bulk_delete",
            data={"ids": deleted_thread_ids},
        )

    return DeleteAllNotificationsResponse(deleted=len(deleted_ids), ids=deleted_ids)

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import NotificationModel, User
from ..schemas.notifications import (
    DeleteAllNotificationsRequest,
    DeleteAllNotificationsResponse,
    MarkNotificationsReadRequest,
    MarkNotificationsReadResponse,
    NotificationListResponse,
    NotificationResponse,
)
from ..services.notification_service import (
    NOTIFICATION_SOURCE_KIND_VALUES,
    collect_notification_delete_deltas,
    delete_notifications,
    get_notifications_by_ids,
    list_notifications,
    mark_notifications_read,
    serialize_notification,
)
from ..services.ownership import require_owned_project
from ..services.runtime_event_dispatcher import runtime_event_dispatcher
from ..services.storage_usage_service import apply_project_usage_deltas


router = APIRouter(prefix="/api/v1", tags=["notifications"])


@router.get("/notifications", response_model=NotificationListResponse)
async def get_notifications(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    include_read: bool = Query(True),
    kind: str | None = Query(None),
    project_id: UUID | None = Query(None),
    important: bool | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if project_id is not None:
        require_owned_project(db, project_id=project_id, user_id=current_user.id)

    normalized_kind = str(kind).strip() if kind is not None else None
    if normalized_kind is not None and normalized_kind not in NOTIFICATION_SOURCE_KIND_VALUES:
        raise HTTPException(status_code=422, detail=f"Unsupported kind: {normalized_kind}")

    rows, total = list_notifications(
        db,
        user_id=current_user.id,
        limit=limit,
        offset=offset,
        include_read=include_read,
        kind=normalized_kind,
        project_id=project_id,
        important=important,
    )

    return NotificationListResponse(
        items=[NotificationResponse(**serialize_notification(row)) for row in rows],
        total=total,
    )


@router.patch("/notifications/read", response_model=MarkNotificationsReadResponse)
async def mark_user_notifications_read(
    payload: MarkNotificationsReadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updated_ids = mark_notifications_read(
        db,
        user_id=current_user.id,
        notification_ids=payload.notification_ids,
        mark_all=payload.mark_all,
    )
    db.commit()

    if updated_ids:
        rows = get_notifications_by_ids(
            db,
            user_id=current_user.id,
            notification_ids=updated_ids,
        )
        for row in rows:
            await runtime_event_dispatcher.emit_user_event(
                user_id=current_user.id,
                event_name="notification:upsert",
                data=serialize_notification(row),
                project_id=row.project_id,
            )

    return MarkNotificationsReadResponse(updated=len(updated_ids), ids=updated_ids)


@router.delete("/notifications/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = get_notifications_by_ids(
        db,
        user_id=current_user.id,
        notification_ids=[notification_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Notification not found")

    deltas_by_project = collect_notification_delete_deltas(
        db,
        user_id=current_user.id,
        notification_ids=[notification_id],
    )
    deleted_rows = delete_notifications(
        db,
        user_id=current_user.id,
        notification_ids=[notification_id],
    )
    if not deleted_rows:
        raise HTTPException(status_code=404, detail="Notification not found")

    for project_id, deltas in deltas_by_project.items():
        apply_project_usage_deltas(
            db,
            user_id=current_user.id,
            project_id=project_id,
            deltas=deltas,
            enforce_quota=False,
        )
    db.commit()

    deleted = deleted_rows[0]
    await runtime_event_dispatcher.emit_user_event(
        user_id=current_user.id,
        event_name="notification:delete",
        data={"id": deleted.id},
        project_id=deleted.project_id,
    )

    return Response(status_code=204)


@router.post("/notifications/delete-all", response_model=DeleteAllNotificationsResponse)
async def delete_all_notifications(
    payload: DeleteAllNotificationsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(NotificationModel).filter(NotificationModel.user_id == current_user.id)
    if payload.only_read:
        q = q.filter(NotificationModel.is_read == True)  # noqa: E712
    target_ids = [row.id for row in q.all()]
    deltas_by_project = collect_notification_delete_deltas(
        db,
        user_id=current_user.id,
        notification_ids=target_ids,
    )
    deleted_rows = delete_notifications(
        db,
        user_id=current_user.id,
        notification_ids=target_ids,
        only_read=payload.only_read,
    )

    for project_id, deltas in deltas_by_project.items():
        apply_project_usage_deltas(
            db,
            user_id=current_user.id,
            project_id=project_id,
            deltas=deltas,
            enforce_quota=False,
        )
    db.commit()

    deleted_ids = [row.id for row in deleted_rows]
    if deleted_ids:
        await runtime_event_dispatcher.emit_user_event(
            user_id=current_user.id,
            event_name="notification:bulk_delete",
            data={"ids": deleted_ids},
        )

    return DeleteAllNotificationsResponse(deleted=len(deleted_ids), ids=deleted_ids)

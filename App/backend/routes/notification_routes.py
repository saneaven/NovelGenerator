from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import NotificationModel, Project, User
from ..schemas.notifications import (
    DeleteAllNotificationsRequest,
    DeleteAllNotificationsResponse,
    MarkNotificationsReadRequest,
    MarkNotificationsReadResponse,
    NotificationListResponse,
    NotificationResponse,
)
from ..services.notification_service import (
    NOTIFICATION_SOURCE_VALUES,
    delete_all_notifications,
    delete_notification,
    list_notifications,
    mark_notifications_read,
    serialize_notification,
)
from ..services.runtime_event_dispatcher import runtime_event_dispatcher


router = APIRouter(prefix="/api/v1", tags=["notifications"])


def _owned_project_or_404(db: Session, *, project_id: UUID, user_id: UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


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
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

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
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

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
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

    row = delete_notification(
        db,
        user_id=current_user.id,
        project_id=project_id,
        notification_id=notification_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found")

    payload = {
        "id": str(row.id),
        "source": row.source,
        "source_ref_id": row.source_ref_id,
    }
    db.commit()

    await runtime_event_dispatcher.emit_project_event(
        project_id=project_id,
        event_name="notification:delete",
        data=payload,
    )

    return Response(status_code=204)


@router.post("/projects/{project_id}/notifications/delete-all", response_model=DeleteAllNotificationsResponse)
async def delete_all_project_notifications(
    project_id: UUID,
    payload: DeleteAllNotificationsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

    deleted_ids = delete_all_notifications(
        db,
        user_id=current_user.id,
        project_id=project_id,
        only_read=payload.only_read,
    )
    db.commit()

    if deleted_ids:
        await runtime_event_dispatcher.emit_project_event(
            project_id=project_id,
            event_name="notification:bulk_delete",
            data={"ids": deleted_ids},
        )

    return DeleteAllNotificationsResponse(deleted=len(deleted_ids), ids=deleted_ids)

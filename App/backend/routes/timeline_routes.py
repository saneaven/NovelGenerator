from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..schemas.timeline_schemas import (
    CalendarUpdateRequest,
    FullTimelineResponse,
    TimelineEventCreate,
    TimelineEventLinkRequest,
    TimelineEventLinkResponse,
    TimelineEventResponse,
    TimelineEventUpdate,
    TimelineTrackCreate,
    TimelineTrackMoveRequest,
    TimelineTrackResponse,
    TimelineTrackUpdate,
)
from ..services.ownership import require_owned_project
from ..services.storage_usage_service import StorageQuotaExceededError
from ..services.timeline_service import timeline_service


router = APIRouter(prefix="/api/v1/projects/{project_id}/timeline", tags=["timeline"])

_UNSET = object()


def _optional_uuid(value: str | None, *, field_name: str) -> UUID | None:
    if value in (None, "", "null"):
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}") from exc


@router.get("", response_model=FullTimelineResponse)
async def get_timeline(
    project_id: UUID,
    language: str | None = Query(None),
    tags: list[str] | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    result = timeline_service.get_full_timeline(
        db,
        project_id=project_id,
        language=language,
        tags_filter=tags,
        ensure_exists=True,
        user_id=current_user.id,
    )
    db.commit()
    return FullTimelineResponse(**result)


@router.get("/tracks", response_model=list[TimelineTrackResponse])
async def list_tracks(
    project_id: UUID,
    language: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    tracks = timeline_service.list_tracks(
        db,
        project_id=project_id,
        language=language,
        user_id=current_user.id,
    )
    db.commit()
    return [TimelineTrackResponse(**track) for track in tracks]


@router.post("/tracks", response_model=TimelineTrackResponse)
async def create_track(
    project_id: UUID,
    request: TimelineTrackCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    try:
        result = timeline_service.create_track(
            db,
            project_id=project_id,
            language=request.language,
            name=request.name,
            description=request.description,
            content=request.content,
            rich_text_format=request.rich_text_format,
            parent_id=_optional_uuid(request.parent_id, field_name="parent_id"),
            position=request.position,
            color=request.color,
            user_request=request.user_request,
            user_id=current_user.id,
        )
        db.commit()
        return TimelineTrackResponse(**result)
    except HTTPException:
        db.rollback()
        raise
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")


@router.put("/tracks/{track_id}", response_model=TimelineTrackResponse)
async def update_track(
    project_id: UUID,
    track_id: UUID,
    request: TimelineTrackUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    color: Any = request.color if "color" in request.model_fields_set else _UNSET
    content: Any = request.content if "content" in request.model_fields_set else _UNSET
    try:
        result = timeline_service.update_track(
            db,
            project_id=project_id,
            track_id=track_id,
            language=request.language,
            name=request.name,
            description=request.description,
            content=content,
            rich_text_format=request.rich_text_format,
            color=color,
            user_request=request.user_request,
            create_new_version=request.create_new_version,
            user_id=current_user.id,
        )
        db.commit()
        return TimelineTrackResponse(**result)
    except HTTPException:
        db.rollback()
        raise
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")


@router.delete("/tracks/{track_id}")
async def delete_track(
    project_id: UUID,
    track_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    timeline_service.delete_track(
        db,
        project_id=project_id,
        track_id=track_id,
        user_id=current_user.id,
    )
    db.commit()
    return {"success": True}


@router.patch("/tracks/{track_id}/move", response_model=TimelineTrackResponse)
async def move_track(
    project_id: UUID,
    track_id: UUID,
    request: TimelineTrackMoveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    result = timeline_service.move_track(
        db,
        project_id=project_id,
        track_id=track_id,
        parent_id=_optional_uuid(request.parent_id, field_name="parent_id"),
        position=request.position,
        user_id=current_user.id,
    )
    db.commit()
    return TimelineTrackResponse(**result)


@router.put("/calendar", response_model=FullTimelineResponse)
async def update_calendar(
    project_id: UUID,
    request: CalendarUpdateRequest,
    language: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    try:
        result = timeline_service.update_calendar(
            db,
            project_id=project_id,
            new_calendar=request.calendar.model_dump(),
            user_id=current_user.id,
            language=language,
        )
        db.commit()
        return FullTimelineResponse(**result)
    except HTTPException:
        db.rollback()
        raise
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")


@router.post("/events", response_model=TimelineEventResponse)
async def create_event(
    project_id: UUID,
    request: TimelineEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    try:
        result = timeline_service.create_event(
            db,
            project_id=project_id,
            track_id=UUID(request.track_id),
            language=request.language,
            name=request.name,
            description=request.description,
            content=request.content,
            rich_text_format=request.rich_text_format,
            start_date=request.start_date,
            end_date=request.end_date,
            tags=request.tags,
            links=[link.model_dump() for link in request.links],
            user_request=request.user_request,
            user_id=current_user.id,
        )
        db.commit()
        return TimelineEventResponse(**result)
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")


@router.put("/events/{event_id}", response_model=TimelineEventResponse)
async def update_event(
    project_id: UUID,
    event_id: UUID,
    request: TimelineEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    try:
        result = timeline_service.update_event(
            db,
            project_id=project_id,
            event_id=event_id,
            track_id=UUID(request.track_id) if "track_id" in request.model_fields_set and request.track_id else None,
            language=request.language,
            name=request.name,
            description=request.description,
            content=request.content if "content" in request.model_fields_set else _UNSET,
            rich_text_format=request.rich_text_format,
            start_date=request.start_date if "start_date" in request.model_fields_set else _UNSET,
            end_date=request.end_date if "end_date" in request.model_fields_set else _UNSET,
            tags=request.tags if "tags" in request.model_fields_set else _UNSET,
            user_request=request.user_request,
            create_new_version=request.create_new_version,
            user_id=current_user.id,
        )
        db.commit()
        return TimelineEventResponse(**result)
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")


@router.delete("/events/{event_id}")
async def delete_event(
    project_id: UUID,
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    timeline_service.delete_event(
        db,
        project_id=project_id,
        event_id=event_id,
        user_id=current_user.id,
    )
    db.commit()
    return {"success": True}


@router.post("/events/{event_id}/links", response_model=TimelineEventLinkResponse)
async def create_event_link(
    project_id: UUID,
    event_id: UUID,
    request: TimelineEventLinkRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    try:
        result = timeline_service.link_event(
            db,
            project_id=project_id,
            event_id=event_id,
            object_type=request.object_type,
            object_id=UUID(request.object_id),
            user_id=current_user.id,
        )
        db.commit()
        return TimelineEventLinkResponse(**result)
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/events/{event_id}/links/{link_id}")
async def delete_event_link(
    project_id: UUID,
    event_id: UUID,
    link_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    timeline_service.unlink_event(
        db,
        project_id=project_id,
        event_id=event_id,
        link_id=link_id,
        user_id=current_user.id,
    )
    db.commit()
    return {"success": True}


@router.get("/links", response_model=list[TimelineEventLinkResponse])
async def list_links_by_object(
    project_id: UUID,
    object_type: str = Query(...),
    object_id: UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    result = timeline_service.list_links_by_object(
        db,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
    )
    return [TimelineEventLinkResponse(**row) for row in result]

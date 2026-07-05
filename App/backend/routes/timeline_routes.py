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
    TimelineConfigResponse,
    TimelineEventCreate,
    TimelineEventLinkResponse,
    TimelineEventUpdate,
    TimelineTrackCreate,
    TimelineTrackMoveRequest,
    TimelineTrackUpdate,
)
from ..services.ownership import require_owned_project
from ..services.object_service import object_service
from ..services.storage_usage_service import StorageQuotaExceededError
from ..services.timeline_service import _UNSET, timeline_service
from .unified_object_routes import UnifiedObjectResponse


router = APIRouter(prefix="/api/v1/projects/{project_id}/timeline", tags=["timeline"])


def _optional_uuid(value: str | None, *, field_name: str) -> UUID | None:
    if value in (None, "", "null"):
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}") from exc


def _main_language(current_user: User) -> str:
    settings = getattr(current_user, "settings", None)
    value = getattr(settings, "main_language", None)
    return str(value or "English")


def _timeline_config_response(
    db: Session,
    *,
    project_id: UUID,
    user_id: UUID,
    warnings: list[str] | None = None,
) -> TimelineConfigResponse:
    timeline = timeline_service.get_or_create_timeline(db, project_id=project_id, user_id=user_id)
    return TimelineConfigResponse(
        id=str(timeline.id),
        project_id=str(project_id),
        calendar=timeline.calendar if isinstance(timeline.calendar, dict) else {},
        warnings=warnings or [],
    )


def _serialized_object(
    db: Session,
    *,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
    fallback_language: str,
) -> UnifiedObjectResponse:
    result = object_service.get_object(
        db,
        object_type=object_type,
        object_id=object_id,
        project_id=project_id,
        language=language,
        fallback_language=fallback_language,
    )
    if result is None:
        raise HTTPException(status_code=404, detail=f"{object_type} not found")
    return UnifiedObjectResponse(**result)


@router.get("", response_model=TimelineConfigResponse)
async def get_timeline(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    result = _timeline_config_response(db, project_id=project_id, user_id=current_user.id)
    db.commit()
    return result


@router.post("/tracks", response_model=UnifiedObjectResponse)
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
        response = _serialized_object(
            db,
            project_id=project_id,
            object_type="timeline_track",
            object_id=UUID(str(result["id"])),
            language=request.language,
            fallback_language=_main_language(current_user),
        )
        db.commit()
        return response
    except HTTPException:
        db.rollback()
        raise
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")


@router.put("/tracks/{track_id}", response_model=UnifiedObjectResponse)
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
        response = _serialized_object(
            db,
            project_id=project_id,
            object_type="timeline_track",
            object_id=track_id,
            language=request.language or _main_language(current_user),
            fallback_language=_main_language(current_user),
        )
        db.commit()
        return response
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


@router.patch("/tracks/{track_id}/move", response_model=UnifiedObjectResponse)
async def move_track(
    project_id: UUID,
    track_id: UUID,
    request: TimelineTrackMoveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    timeline_service.move_track(
        db,
        project_id=project_id,
        track_id=track_id,
        parent_id=_optional_uuid(request.parent_id, field_name="parent_id"),
        position=request.position,
        user_id=current_user.id,
    )
    main_language = _main_language(current_user)
    response = _serialized_object(
        db,
        project_id=project_id,
        object_type="timeline_track",
        object_id=track_id,
        language=main_language,
        fallback_language=main_language,
    )
    db.commit()
    return response


@router.put("/calendar", response_model=TimelineConfigResponse)
async def update_calendar(
    project_id: UUID,
    request: CalendarUpdateRequest,
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
        )
        db.commit()
        return TimelineConfigResponse(
            id=str(result.get("id") or ""),
            project_id=str(project_id),
            calendar=result.get("calendar") if isinstance(result.get("calendar"), dict) else {},
            warnings=result.get("warnings") if isinstance(result.get("warnings"), list) else [],
        )
    except HTTPException:
        db.rollback()
        raise
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")


@router.post("/events", response_model=UnifiedObjectResponse)
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
        response = _serialized_object(
            db,
            project_id=project_id,
            object_type="timeline_event",
            object_id=UUID(str(result["id"])),
            language=request.language,
            fallback_language=_main_language(current_user),
        )
        db.commit()
        return response
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")


@router.put("/events/{event_id}", response_model=UnifiedObjectResponse)
async def update_event(
    project_id: UUID,
    event_id: UUID,
    request: TimelineEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    try:
        timeline_service.update_event(
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
            links=(
                [link.model_dump() for link in request.links]
                if request.links is not None
                else []
            ) if "links" in request.model_fields_set else _UNSET,
            user_request=request.user_request,
            create_new_version=request.create_new_version,
            user_id=current_user.id,
        )
        response = _serialized_object(
            db,
            project_id=project_id,
            object_type="timeline_event",
            object_id=event_id,
            language=request.language or _main_language(current_user),
            fallback_language=_main_language(current_user),
        )
        db.commit()
        return response
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

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models.db_models import User
from ..schemas.thread_api import (
    CreateJourneyRequest,
    CreateJourneyResponse,
    DeleteAllJourneysResponse,
    JourneyListResponse,
    JourneyResponse,
    ThreadRunResponse,
)
from ..services.journey_service import JourneyRuntimeRow, JourneyService
from ..services.ownership import require_owned_project
from ..services.run_pipeline import run_pipeline
from ..services.runtime_event_dispatcher import runtime_event_dispatcher


router = APIRouter(prefix="/api/v1", tags=["journeys"])
journey_service = JourneyService(
    db_factory=SessionLocal,
    run_pipeline=run_pipeline,
    event_dispatcher=runtime_event_dispatcher,
)


def _serialize_journey(row: JourneyRuntimeRow) -> JourneyResponse:
    return JourneyResponse(
        journey_id=row.journey_id,
        project_id=row.project_id,
        thread_id=row.thread_id,
        latest_run_id=row.latest_run_id,
        latest_message_at=row.latest_message_at,
        kind=row.kind,
        display_label=row.display_label,
        status=row.status,
        last_error=row.last_error,
        updated_at=row.updated_at,
    )


@router.post("/projects/{project_id}/journeys", response_model=CreateJourneyResponse, status_code=201)
async def create_journey(
    project_id: UUID,
    payload: CreateJourneyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)
    journey, thread, run = await journey_service.create_and_start_journey(
        project_id=project_id,
        user_id=current_user.id,
        kind=payload.kind,
        display_label=payload.display_label,
        input_text=payload.input_text,
        input_payload=payload.input_payload,
        run_mode=payload.run_mode,
        surface=payload.surface,
        context_object_ids=payload.context_object_ids,
        journey_target_ids=payload.journey_target_ids,
        language=payload.language,
        mcp_selections=payload.mcp_selections,
    )
    return CreateJourneyResponse(
        journey_id=journey.id,
        thread_id=thread.id,
        run_id=run.id,
        status=journey.status,
    )


@router.get("/projects/{project_id}/journeys", response_model=JourneyListResponse)
async def list_project_journeys(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)
    rows = journey_service.list_project_journeys(
        db,
        project_id=project_id,
        user_id=current_user.id,
    )
    return JourneyListResponse(items=[_serialize_journey(row) for row in rows])


@router.get("/journeys/{journey_id}", response_model=JourneyResponse)
async def get_journey(
    journey_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    journey = journey_service.require_owned_journey(db, journey_id=journey_id, user_id=current_user.id)
    rows = journey_service.list_project_journeys(
        db,
        project_id=journey.project_id,
        user_id=current_user.id,
    )
    for row in rows:
        if row.journey_id == journey.id:
            return _serialize_journey(row)
    raise RuntimeError("Journey runtime row not found after ownership check")


@router.post("/journeys/{journey_id}/cancel", status_code=200)
async def cancel_journey(
    journey_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    journey = journey_service.require_owned_journey(db, journey_id=journey_id, user_id=current_user.id)
    thread = journey_service.get_child_thread(db, journey_id=journey.id)
    if thread is None:
        return {"success": True}
    await run_pipeline.cancel_run(thread_id=thread.id, user_id=current_user.id)
    return {"success": True}


@router.post("/journeys/{journey_id}/resume", response_model=ThreadRunResponse)
async def resume_journey(
    journey_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    journey = journey_service.require_owned_journey(db, journey_id=journey_id, user_id=current_user.id)
    thread = journey_service.get_child_thread(db, journey_id=journey.id)
    if thread is None:
        raise RuntimeError("Journey thread not found")
    run = await run_pipeline.resume_run(
        thread_id=thread.id,
        user_id=current_user.id,
        run_mode=None,
        surface=None,
        context_object_ids=[],
        journey_target_ids=[],
        language=None,
    )
    return ThreadRunResponse(
        thread_id=thread.id,
        run_id=run.id,
        status=run.status,
        thread_status=thread.status,
    )


@router.post("/projects/{project_id}/journeys/delete-all", response_model=DeleteAllJourneysResponse)
async def delete_all_project_journeys(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)
    deleted = await journey_service.delete_all_project_journeys(
        project_id=project_id,
        user_id=current_user.id,
    )
    return DeleteAllJourneysResponse(deleted=deleted)


@router.delete("/projects/{project_id}/journeys/{journey_id}", status_code=204)
async def delete_journey(
    project_id: UUID,
    journey_id: UUID,
    current_user: User = Depends(get_current_user),
):
    await journey_service.delete_journey(
        project_id=project_id,
        journey_id=journey_id,
        user_id=current_user.id,
    )
    return Response(status_code=204)

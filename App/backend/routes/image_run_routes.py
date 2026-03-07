from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..schemas.assets import (
    CreateImageRunRequest,
    ImageRunDecisionRequest,
    ImageRunListResponse,
    ImageRunResponse,
)
from ..services.image_run_service import image_run_service
from ..services.ownership import require_owned_project


router = APIRouter(prefix="/api/v1/projects", tags=["image-runs"])


@router.post("/{project_id}/image-runs", response_model=ImageRunResponse)
async def create_image_run(
    project_id: UUID,
    payload: CreateImageRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)
    try:
        row = image_run_service.create_direct_run(
            db,
            project_id=project_id,
            user_id=current_user.id,
            request=payload,
        )
        db.commit()
        db.refresh(row)
        response = image_run_service.serialize(db, row)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await image_run_service.start_run(row.id)
    return response


@router.get("/{project_id}/image-runs", response_model=ImageRunListResponse)
async def list_image_runs(
    project_id: UUID,
    scope: str = Query("recent"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)
    normalized_scope = str(scope or "recent").strip().lower()
    if normalized_scope not in {"active", "recent"}:
        raise HTTPException(status_code=422, detail="scope must be active|recent")
    rows = image_run_service.list_runs(
        db,
        project_id=project_id,
        user_id=current_user.id,
        scope=normalized_scope,
    )
    return ImageRunListResponse(items=[image_run_service.serialize(db, row) for row in rows])


@router.get("/{project_id}/image-runs/{image_run_id}", response_model=ImageRunResponse)
async def get_image_run(
    project_id: UUID,
    image_run_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)
    row = image_run_service.require_owned_run(
        project_id=project_id,
        user_id=current_user.id,
        image_run_id=image_run_id,
        db=db,
    )
    return image_run_service.serialize(db, row)


@router.post("/{project_id}/image-runs/{image_run_id}/decision", response_model=ImageRunResponse)
async def decide_image_run(
    project_id: UUID,
    image_run_id: UUID,
    payload: ImageRunDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)
    row = await image_run_service.decide_run(
        project_id=project_id,
        user_id=current_user.id,
        image_run_id=image_run_id,
        decision=payload.decision,
    )
    db.expire_all()
    owned = image_run_service.require_owned_run(
        project_id=project_id,
        user_id=current_user.id,
        image_run_id=image_run_id,
        db=db,
    )
    return image_run_service.serialize(db, owned if owned is not None else row)


@router.post("/{project_id}/image-runs/{image_run_id}/cancel", response_model=ImageRunResponse)
async def cancel_image_run(
    project_id: UUID,
    image_run_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)
    row = await image_run_service.cancel_run(
        project_id=project_id,
        user_id=current_user.id,
        image_run_id=image_run_id,
    )
    db.expire_all()
    owned = image_run_service.require_owned_run(
        project_id=project_id,
        user_id=current_user.id,
        image_run_id=image_run_id,
        db=db,
    )
    return image_run_service.serialize(db, owned if owned is not None else row)

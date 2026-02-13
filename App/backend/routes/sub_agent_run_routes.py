"""Routes for persistent Sub Agent runs — incremental persistence."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import Agent, Project, User
from ..schemas.sub_agent_runs import (
    AddMessageRequest,
    AddMessageResponse,
    CreateRunRequest,
    CreateRunResponse,
    PatchRunRequest,
    PatchRunResponse,
    SubAgentRunQueryByMessagesRequest,
    SubAgentRunQueryByMessagesResponse,
    UpdateMessageRequest,
    UpdateMessageResponse,
)
from ..services.sub_agent_run_service import sub_agent_run_service


router = APIRouter(
    prefix="/api/v1/projects/{project_id}/agents/{agent_id}/sub-agent-runs",
    tags=["SubAgentRuns"],
)


async def verify_agent_access(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    current_user: User,
    db: Session,
) -> None:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.user_id == current_user.id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    agent = (
        db.query(Agent)
        .filter(Agent.id == agent_id, Agent.project_id == project_id)
        .first()
    )
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")


# ---------------------------------------------------------------------------
# POST /sub-agent-runs — create run
# ---------------------------------------------------------------------------

@router.post("", response_model=CreateRunResponse, status_code=status.HTTP_201_CREATED)
async def create_sub_agent_run(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    data: CreateRunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        run = sub_agent_run_service.create_run(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"run": run}


# ---------------------------------------------------------------------------
# PATCH /sub-agent-runs/{run_id} — patch run
# ---------------------------------------------------------------------------

@router.patch("/{run_id}", response_model=PatchRunResponse, status_code=status.HTTP_200_OK)
async def patch_sub_agent_run(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    data: PatchRunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        run = sub_agent_run_service.patch_run(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"run": run}


# ---------------------------------------------------------------------------
# POST /sub-agent-runs/{run_id}/messages — add message
# ---------------------------------------------------------------------------

@router.post("/{run_id}/messages", response_model=AddMessageResponse, status_code=status.HTTP_201_CREATED)
async def add_sub_agent_run_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    data: AddMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        message = sub_agent_run_service.add_message(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"message": message}


# ---------------------------------------------------------------------------
# PUT /sub-agent-runs/{run_id}/messages/{message_id} — update message
# ---------------------------------------------------------------------------

@router.put("/{run_id}/messages/{message_id}", response_model=UpdateMessageResponse, status_code=status.HTTP_200_OK)
async def update_sub_agent_run_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    message_id: uuid.UUID,
    data: UpdateMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        message = sub_agent_run_service.update_message(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            message_id=message_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"message": message}


# ---------------------------------------------------------------------------
# POST /sub-agent-runs/query-by-messages — query trees
# ---------------------------------------------------------------------------

@router.post("/query-by-messages", response_model=SubAgentRunQueryByMessagesResponse, status_code=status.HTTP_200_OK)
async def query_sub_agent_runs_by_messages(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    data: SubAgentRunQueryByMessagesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    items = sub_agent_run_service.query_by_root_agent_messages(
        db=db,
        project_id=project_id,
        agent_id=agent_id,
        data=data,
    )
    return {"items": items}

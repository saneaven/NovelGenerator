"""Routes for persistent Sub Agent invocation snapshots."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import Agent, Project, User
from ..schemas.sub_agent_invocations import (
    SubAgentInvocationQueryByMessagesRequest,
    SubAgentInvocationQueryByMessagesResponse,
    SubAgentInvocationSnapshotRequest,
    SubAgentInvocationSnapshotResponse,
)
from ..services.sub_agent_invocation_service import sub_agent_invocation_service


router = APIRouter(
    prefix="/api/v1/projects/{project_id}/agents/{agent_id}/sub-agent-invocations",
    tags=["SubAgentInvocations"],
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


@router.post("/snapshots", response_model=SubAgentInvocationSnapshotResponse, status_code=status.HTTP_200_OK)
async def upsert_sub_agent_snapshot(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    data: SubAgentInvocationSnapshotRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        invocation = sub_agent_invocation_service.upsert_snapshot(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"invocation": invocation}


@router.post("/query-by-messages", response_model=SubAgentInvocationQueryByMessagesResponse, status_code=status.HTTP_200_OK)
async def query_sub_agent_invocations_by_messages(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    data: SubAgentInvocationQueryByMessagesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    items = sub_agent_invocation_service.query_by_root_agent_messages(
        db=db,
        project_id=project_id,
        agent_id=agent_id,
        data=data,
    )
    return {"items": items}


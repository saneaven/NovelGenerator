"""Unified run runtime routes."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import Agent, Project, User
from ..schemas.runs import (
    AddRunMessageRequest,
    AddRunMessageResponse,
    CreateRunRequest,
    CreateRunResponse,
    GetRunResponse,
    PatchRunMessageRequest,
    PatchRunMessageResponse,
    PatchRunRequest,
    PatchRunResponse,
    QueryRunsRequest,
    QueryRunsResponse,
    TranslateRunMessageRequest,
    TranslateRunMessageResponse,
    UpsertRunToolCallsRequest,
    UpsertRunToolCallsResponse,
    PatchRunToolCallsRequest,
)
from ..services.run_message_service import run_message_service
from ..services.run_service import run_service
from ..services.run_tool_call_service import run_tool_call_service


router = APIRouter(
    prefix="/api/v1/projects/{project_id}/agents/{agent_id}/runs",
    tags=["runs"],
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


@router.post("", response_model=CreateRunResponse, status_code=status.HTTP_201_CREATED)
async def create_run(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    data: CreateRunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        run = run_service.create_run(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"run": run}


@router.patch("/{run_id}", response_model=PatchRunResponse, status_code=status.HTTP_200_OK)
async def patch_run(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    data: PatchRunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        run = run_service.patch_run(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"run": run}


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_run(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a run and all its child runs."""
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        run_service.delete_run_tree(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    return None


@router.get("/{run_id}", response_model=GetRunResponse, status_code=status.HTTP_200_OK)
async def get_run(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    include_messages: bool = Query(True),
    include_tool_calls: bool = Query(True),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        run = run_service.get_run(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            include_messages=include_messages,
            include_tool_calls=include_tool_calls,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    return {"run": run}


@router.post("/query", response_model=QueryRunsResponse, status_code=status.HTTP_200_OK)
async def query_runs(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    data: QueryRunsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)
    items = run_service.query_runs(
        db=db,
        project_id=project_id,
        agent_id=agent_id,
        data=data,
    )
    return {"items": items}


@router.post("/{run_id}/messages", response_model=AddRunMessageResponse, status_code=status.HTTP_201_CREATED)
async def add_run_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    data: AddRunMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        message = run_message_service.add_run_message(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"message": message}


@router.patch("/{run_id}/messages/{run_message_id}", response_model=PatchRunMessageResponse, status_code=status.HTTP_200_OK)
async def patch_run_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    run_message_id: uuid.UUID,
    data: PatchRunMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        message = run_message_service.patch_run_message(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            message_id=run_message_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"message": message}


@router.delete("/{run_id}/messages/{run_message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_run_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    run_message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a single message from a run."""
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        run_message_service.delete_run_message(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            message_id=run_message_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    return None


@router.put(
    "/{run_id}/messages/{run_message_id}/translate",
    response_model=TranslateRunMessageResponse,
    status_code=status.HTTP_200_OK,
)
async def translate_run_message(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    run_message_id: uuid.UUID,
    data: TranslateRunMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        message = run_message_service.translate_run_message(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            message_id=run_message_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"message": message}


@router.put(
    "/{run_id}/messages/{run_message_id}/tool-calls",
    response_model=UpsertRunToolCallsResponse,
    status_code=status.HTTP_200_OK,
)
async def upsert_run_tool_calls(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    run_message_id: uuid.UUID,
    data: UpsertRunToolCallsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        rows = run_tool_call_service.upsert_run_tool_calls(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            message_id=run_message_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"tool_calls": rows}


@router.patch(
    "/{run_id}/messages/{run_message_id}/tool-calls",
    response_model=UpsertRunToolCallsResponse,
    status_code=status.HTTP_200_OK,
)
async def patch_run_tool_calls(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    run_id: uuid.UUID,
    run_message_id: uuid.UUID,
    data: PatchRunToolCallsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    try:
        rows = run_tool_call_service.patch_run_tool_calls(
            db=db,
            project_id=project_id,
            agent_id=agent_id,
            run_id=run_id,
            message_id=run_message_id,
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"tool_calls": rows}


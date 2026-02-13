"""Timeline routes for unified run history."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import Agent, Project, User
from ..schemas.runs import TimelineResponse
from ..services.timeline_service import timeline_service


router = APIRouter(
    prefix="/api/v1/projects/{project_id}/agents/{agent_id}/timeline",
    tags=["timeline"],
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


@router.get("", response_model=TimelineResponse, status_code=status.HTTP_200_OK)
async def get_timeline(
    project_id: uuid.UUID,
    agent_id: uuid.UUID,
    include_children: bool = Query(True),
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    await verify_agent_access(project_id, agent_id, current_user, db)

    roots, next_cursor = timeline_service.get_timeline(
        db=db,
        project_id=project_id,
        agent_id=agent_id,
        include_children=include_children,
        limit=limit,
        cursor=cursor,
    )

    items: List[Dict[str, Any]] = []
    for root in roots:
        children = getattr(root, "_timeline_children", []) or []
        items.append({
            "root_run_id": root.id,
            "root_run_seq": int(root.root_run_seq or 0),
            "status": root.status,
            "messages": root.messages,
            "child_runs": [
                {
                    "run_id": child.id,
                    "parent_run_tool_call_id": str(child.parent_run_tool_call_id or ""),
                    "status": child.status,
                    "final_output": child.final_output,
                }
                for child in children
            ],
        })

    return {
        "items": items,
        "next_cursor": next_cursor,
    }


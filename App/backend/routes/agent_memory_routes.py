"""Agent long-term memory routes (summary + chat RAG)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import Agent, Project, User
from ..schemas.agent_memory import (
    AgentMemoryArchiveRequest,
    AgentMemoryArchiveResponse,
    AgentMemorySearchRequest,
    AgentMemorySearchResponse,
    AgentMemoryStatusResponse,
    AgentMemoryRelevantChat,
)
from ..services.agent_memory_service import archive_until, get_memory_status, search_memory


router = APIRouter(prefix="/api/v1/projects/{project_id}/agents/{agent_id}/memory", tags=["agent_memory"])


def _get_project_or_404(db: Session, *, user_id: UUID, project_id: UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _get_agent_or_404(db: Session, *, project_id: UUID, agent_id: UUID) -> Agent:
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.project_id == project_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.get("/status", response_model=AgentMemoryStatusResponse)
async def agent_memory_status(
    project_id: UUID,
    agent_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, user_id=current_user.id, project_id=project_id)
    agent = _get_agent_or_404(db, project_id=project_id, agent_id=agent_id)
    data = get_memory_status(db, user_id=current_user.id, agent=agent)
    return AgentMemoryStatusResponse(**data)


@router.post("/archive", response_model=AgentMemoryArchiveResponse)
async def agent_memory_archive(
    project_id: UUID,
    agent_id: UUID,
    request: AgentMemoryArchiveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, user_id=current_user.id, project_id=project_id)
    agent = _get_agent_or_404(db, project_id=project_id, agent_id=agent_id)

    try:
        result = await archive_until(
            db,
            current_user=current_user,
            project_id=project_id,
            agent=agent,
            language=request.language,
            archive_until_message_id=request.archive_until_message_id,
            summary_messages=[m.model_dump() for m in request.summary_messages],
            summary_provider_request_config=request.summary_config.model_dump(),
            embedding_provider_request_config=request.embedding_config.model_dump(),
        )
        return AgentMemoryArchiveResponse(
            archived_until_message_id=result.get("archived_until_message_id"),
            summary_id=result.get("summary_id"),
            summary_text=result.get("summary_text"),
            archived_message_ids=result.get("archived_message_ids") or [],
            indexed_count=int(result.get("indexed_count") or 0),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search", response_model=AgentMemorySearchResponse)
async def agent_memory_search(
    project_id: UUID,
    agent_id: UUID,
    request: AgentMemorySearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, user_id=current_user.id, project_id=project_id)
    _get_agent_or_404(db, project_id=project_id, agent_id=agent_id)

    results = await search_memory(
        db,
        current_user=current_user,
        project_id=project_id,
        agent_id=agent_id,
        language=request.language,
        queries=request.queries,
        top_k_per_query=request.top_k_per_query,
        provider_request_config=request.config.model_dump(),
    )

    return AgentMemorySearchResponse(
        results=[
            AgentMemoryRelevantChat(
                message_id=r["message_id"],
                role=r["role"],
                content=r["content"],
                created_at=r["created_at"],
                distance=r.get("distance"),
            )
            for r in results
        ]
    )

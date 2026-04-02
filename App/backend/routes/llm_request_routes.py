"""API routes for LLM request tracking."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..schemas.llm_request import LLMRequestDetail, LLMRequestListResponse, LLMRequestSummary
from ..services.llm_request_service import llm_request_service

router = APIRouter(prefix="/api/v1/llm-requests", tags=["llm-requests"])


@router.get("", response_model=LLMRequestListResponse)
async def list_llm_requests(
    limit: int = 50,
    offset: int = 0,
    project_id: UUID | None = None,
    thread_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows, total = llm_request_service.list_requests(
        db,
        user_id=current_user.id,
        limit=min(limit, 200),
        offset=offset,
        project_id=project_id,
        thread_id=thread_id,
    )
    items = [
        LLMRequestSummary(
            request_id=row.request_id,
            status=row.status,
            provider=row.provider,
            model=row.model,
            created_at=row.created_at,
            completed_at=row.completed_at,
            retry_count=int(row.retry_count or 0),
            meta=row.meta,
        )
        for row in rows
    ]
    return LLMRequestListResponse(items=items, total=total)


@router.get("/{request_id}", response_model=LLMRequestDetail)
async def get_llm_request(
    request_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = llm_request_service.get_request(db, user_id=current_user.id, request_id=request_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return LLMRequestDetail(
        request_id=row.request_id,
        status=row.status,
        provider=row.provider,
        model=row.model,
        created_at=row.created_at,
        completed_at=row.completed_at,
        retry_count=int(row.retry_count or 0),
        run_id=str(row.run_id),
        thread_id=str(row.thread_id),
        assistant_message_id=str(row.assistant_message_id),
        raw_input=row.raw_input if isinstance(row.raw_input, dict) else None,
        raw_output=row.raw_output if isinstance(row.raw_output, dict) else None,
        error=row.error,
        meta=row.meta,
    )


@router.delete("")
async def clear_llm_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deleted = llm_request_service.delete_requests(db, user_id=current_user.id)
    return {"deleted": deleted}

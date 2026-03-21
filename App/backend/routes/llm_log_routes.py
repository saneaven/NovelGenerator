"""API routes for LLM request/response logs."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..schemas.llm_log import LLMLogDetail, LLMLogListResponse, LLMLogSummary
from ..services.llm_log_service import llm_log_service

router = APIRouter(prefix="/api/v1/llm-logs", tags=["llm-logs"])


@router.get("", response_model=LLMLogListResponse)
async def list_llm_logs(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List recent LLM logs (summary only, no raw payloads)."""
    rows, total = llm_log_service.list_logs(
        db, user_id=current_user.id, limit=min(limit, 200), offset=offset,
    )
    items = [
        LLMLogSummary(
            id=str(row.id),
            provider=row.provider,
            model=row.model,
            status=row.status,
            created_at=row.created_at,
            completed_at=row.completed_at,
            meta=row.meta,
        )
        for row in rows
    ]
    return LLMLogListResponse(items=items, total=total)


@router.get("/{log_id}", response_model=LLMLogDetail)
async def get_llm_log(
    log_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single LLM log with full raw payloads."""
    row = llm_log_service.get_log(db, user_id=current_user.id, log_id=log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Log not found")
    return LLMLogDetail(
        id=str(row.id),
        provider=row.provider,
        model=row.model,
        status=row.status,
        created_at=row.created_at,
        completed_at=row.completed_at,
        meta=row.meta,
        raw_input=row.raw_input or {},
        raw_output=row.raw_output,
        error=row.error,
    )


@router.delete("")
async def clear_llm_logs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete all LLM logs for the current user."""
    deleted = llm_log_service.delete_logs(db, user_id=current_user.id)
    return {"deleted": deleted}

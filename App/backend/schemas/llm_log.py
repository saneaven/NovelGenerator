"""Pydantic schemas for LLM log endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class LLMLogSummary(BaseModel):
    """Lightweight row returned by the list endpoint (no raw payloads)."""
    id: str
    provider: str
    model: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    meta: Optional[Dict[str, Any]] = None


class LLMLogDetail(LLMLogSummary):
    """Full row returned by the detail endpoint."""
    raw_input: Dict[str, Any]
    raw_output: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class LLMLogListResponse(BaseModel):
    items: List[LLMLogSummary]
    total: int

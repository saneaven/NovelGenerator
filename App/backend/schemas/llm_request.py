"""Pydantic schemas for LLM request endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class LLMRequestSummary(BaseModel):
    request_id: str
    status: str
    provider: str
    model: str
    created_at: datetime
    completed_at: datetime | None = None
    retry_count: int
    meta: dict[str, Any] | None = None


class LLMRequestDetail(LLMRequestSummary):
    run_id: str
    thread_id: str
    assistant_message_id: str
    raw_input: dict[str, Any] | None = None
    raw_output: dict[str, Any] | None = None
    error: str | None = None


class LLMRequestListResponse(BaseModel):
    items: list[LLMRequestSummary]
    total: int

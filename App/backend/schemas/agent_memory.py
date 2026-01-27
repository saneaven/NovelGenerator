"""Schemas for Agent long-term memory (summary + RAG)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from ..models.requests import ProviderConfig


class AgentMemoryStatusResponse(BaseModel):
    hasMemory: bool
    summaryCount: int
    lastSummaryText: Optional[str] = None
    archivedUntilMessageId: Optional[UUID] = None
    indexedMessageCount: int = 0


class SummaryMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., min_length=1)


class AgentMemoryArchiveRequest(BaseModel):
    language: str = Field(default="English", min_length=1)
    archive_until_message_id: UUID
    summary_messages: List[SummaryMessage]
    summary_config: ProviderConfig = Field(default_factory=ProviderConfig)
    embedding_config: ProviderConfig = Field(default_factory=ProviderConfig)


class AgentMemoryArchiveResponse(BaseModel):
    archived_until_message_id: Optional[UUID] = None
    summary_id: Optional[UUID] = None
    summary_text: Optional[str] = None
    archived_message_ids: List[UUID] = []
    indexed_count: int = 0


class AgentMemorySearchRequest(BaseModel):
    language: str = Field(default="English", min_length=1)
    queries: List[str] = Field(default_factory=list)
    top_k_per_query: int = Field(default=20, ge=1, le=200)
    config: ProviderConfig = Field(default_factory=ProviderConfig)


class AgentMemoryRelevantChat(BaseModel):
    message_id: UUID
    role: str
    content: str
    created_at: datetime
    distance: Optional[float] = None


class AgentMemorySearchResponse(BaseModel):
    results: List[AgentMemoryRelevantChat]

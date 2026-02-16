"""Schemas for message long-term memory (summary + RAG)."""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from .agents import ToolCallSchema


class MemoryStatusResponse(BaseModel):
    hasMemory: bool
    summaryCount: int
    lastSummaryText: Optional[str] = None
    archivedUntilMessageId: Optional[UUID] = None
    indexedMessageCount: int = 0


class SummaryMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., min_length=1)

class ArchivedMessage(BaseModel):
    message_id: UUID
    role: Literal["system", "user", "assistant"]
    # Allow empty content for tool-call-only assistant messages.
    content: str = ""
    created_at: Optional[datetime] = None
    tool_calls: Optional[List[ToolCallSchema]] = None


class MemoryArchiveRequest(BaseModel):
    language: str = Field(default="English", min_length=1)
    archive_until_message_id: UUID
    summary_text: str = Field(..., min_length=1)
    archived_messages: List[ArchivedMessage] = Field(default_factory=list)


class MemoryArchiveResponse(BaseModel):
    archived_until_message_id: Optional[UUID] = None
    summary_id: Optional[UUID] = None
    summary_text: Optional[str] = None
    archived_message_ids: List[UUID] = []
    indexed_count: int = 0


class MemorySearchRequest(BaseModel):
    language: str = Field(default="English", min_length=1)
    queries: List[str] = Field(default_factory=list)
    top_k_per_query: int = Field(default=20, ge=1, le=200)


class MemoryRelevantChat(BaseModel):
    message_id: UUID
    role: str
    content: str
    created_at: datetime
    distance: Optional[float] = None
    field_path: Optional[str] = None
    chunk_index: Optional[int] = None


class MemorySearchResponse(BaseModel):
    results: List[MemoryRelevantChat]

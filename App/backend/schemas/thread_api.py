from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    input_text: str = ""
    run_mode: Literal["planMode", "agentMode"] | None = None
    surface: str | None = None
    context_object_ids: list[UUID] = Field(default_factory=list)
    journey_target_ids: list[UUID] = Field(default_factory=list)
    language: str | None = None


class ChatResponse(BaseModel):
    thread_id: UUID
    run_id: UUID
    status: str
    thread_status: str


class ToolCallDecisionRequest(BaseModel):
    decision: Literal["accept", "reject"]
    reason: str | None = None


class ToolCallBatchDecisionItem(BaseModel):
    tool_call_id: UUID
    decision: Literal["accept", "reject"]
    reason: str | None = None


class ToolCallBatchDecisionRequest(BaseModel):
    decisions: list[ToolCallBatchDecisionItem]


class SubAgentCompleteRequest(BaseModel):
    result: str


class CreateThreadRequest(BaseModel):
    thread_type: Literal["journey"] = "journey"
    journey_kind: str
    owner_id: UUID | None = None


class MessageResponse(BaseModel):
    id: UUID
    thread_id: UUID
    run_id: UUID
    role: Literal["system", "user", "assistant", "tool_call", "tool_result"]
    seq: int
    seq_in_thread: int
    data: dict[str, Any]
    created_at: datetime


class ToolCallResponse(BaseModel):
    id: UUID
    thread_id: UUID
    run_id: UUID
    message_id: UUID
    assistant_message_id: UUID | None
    result_message_id: UUID | None
    call_seq: int
    llm_call_id: str
    tool_name: str
    arguments: dict[str, Any]
    status: str
    reason: str | None
    result: dict[str, Any] | None
    child_thread_id: UUID | None
    accepted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ThreadMessagesResponse(BaseModel):
    thread: dict[str, Any]
    latest_run: dict[str, Any] | None
    messages: list[MessageResponse]
    tool_calls: list[ToolCallResponse]


class ToolCallDecisionResponse(BaseModel):
    tool_call: ToolCallResponse
    new_objects: list[dict[str, Any]] | None = None


class ToolCallBatchDecisionResponse(BaseModel):
    results: list[ToolCallDecisionResponse]

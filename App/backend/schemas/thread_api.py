"""Request/response schemas for the thread-based API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


ThreadType = Literal["agent", "subAgent", "journey"]
ThreadStatus = Literal["idle", "running", "waiting_tools", "paused", "error"]
RunStatus = Literal["running", "waiting", "paused", "completed", "error", "cancelled"]
RunMode = Literal["planMode", "agentMode"]
RunSurface = Literal["story-object", "outline-manager", "novel-editor", "config"]
JourneyKind = Literal["aiEdit", "translation", "imagePrompt"]
ToolDecision = Literal["accept", "reject", "cancel"]
RunToolCallStatus = Literal["pending", "running", "accepted", "rejected", "failed"]


# ── Dispatch ──

class DispatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    thread_type: ThreadType
    thread_id: UUID | None = None
    input_text: str = ""
    language: str

    # Agent-specific
    run_mode: RunMode | None = None
    surface: RunSurface | None = None
    context_object_ids: list[str] = Field(default_factory=list)

    # Journey-specific
    journey_kind: JourneyKind | None = None
    input_payload: dict[str, Any] = Field(default_factory=dict)
    journey_target_ids: list[str] = Field(default_factory=list)
    client_message_id: str | None = None

    @model_validator(mode="after")
    def validate_client_message_id(self):
        if self.thread_type != "journey" and not self.client_message_id:
            raise ValueError("client_message_id is required for agent/subAgent dispatch")
        return self


# ── Tool decisions ──

class ToolDecisionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: UUID
    decisions: dict[str, ToolDecision] = Field(default_factory=dict)
    options: dict[str, Any] | None = None


# ── Message editing ──

class PatchMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str
    content_parts: list[dict] | None = None
    thinking_details: list[dict] | None = None


# ── Response models ──

class ThreadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    user_id: UUID
    thread_type: ThreadType
    owner_id: UUID | None = None
    journey_kind: JourneyKind | None = None
    status: ThreadStatus
    created_at: datetime
    updated_at: datetime


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    thread_id: UUID
    user_id: UUID
    project_id: UUID
    status: RunStatus
    run_seq: int | None = None
    language: str
    input_text: str
    input_payload: dict[str, Any] = Field(default_factory=dict)
    final_output: str | None = None
    error: str | None = None
    run_mode: RunMode | None = None
    surface: RunSurface | None = None
    context_object_ids: list[str] = Field(default_factory=list)
    journey_target_ids: list[str] = Field(default_factory=list)
    parent_run_id: UUID | None = None
    next_message_seq: int = 1
    created_at: datetime
    updated_at: datetime


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    thread_id: UUID
    seq: int
    seq_in_thread: int | None = None
    role: str
    data: dict[str, Any]
    created_at: datetime


class ToolCallResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    thread_id: UUID
    message_id: UUID
    call_seq: int
    llm_call_id: str
    tool_name: str
    arguments: dict[str, Any]
    status: RunToolCallStatus
    reason: str | None = None
    result: dict[str, Any] | None = None
    child_thread_id: UUID | None = None
    accepted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ThreadStateResponse(BaseModel):
    thread: ThreadResponse
    messages: list[MessageResponse] = Field(default_factory=list)
    tool_calls: list[ToolCallResponse] = Field(default_factory=list)
    last_error: str | None = None

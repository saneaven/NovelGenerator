from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    input_text: str = ""
    input_payload: dict[str, Any] | None = None
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


class CreateThreadRequest(BaseModel):
    thread_type: Literal["journey"] = "journey"
    journey_kind: Literal[
        "manuscriptEdit",
        "outlineEdit",
        "storyObjectEdit",
        "objectTranslation",
        "imagePrompt",
        "sceneImagePrompt",
        "messageTranslation",
    ]
    owner_id: UUID | None = None
    notification_label: str | None = None
    notification_meta: dict[str, Any] | None = None


class MessageResponse(BaseModel):
    id: UUID
    thread_id: UUID
    run_id: UUID
    role: Literal["system", "user", "assistant", "tool_call"]
    seq: int
    seq_in_thread: int
    data: dict[str, Any]
    created_at: datetime


class PatchContentPart(BaseModel):
    type: Literal["content"]
    text: str


class PatchMessageRequest(BaseModel):
    language: str
    content_parts: list[PatchContentPart]
    reasoning_detail: dict[str, Any] | None = None
    set_final: bool = False


class ToolCallResponse(BaseModel):
    id: UUID
    thread_id: UUID
    run_id: UUID
    message_id: UUID
    assistant_message_id: UUID | None
    call_seq: int
    llm_call_id: str
    tool_name: str
    arguments: dict[str, Any]
    extra_content: dict[str, Any] | None = None
    status: str
    reason: str | None
    result: dict[str, Any] | None
    child_thread_id: UUID | None
    accepted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ThreadInfoResponse(BaseModel):
    id: UUID
    project_id: UUID
    thread_type: Literal["agent", "subAgent", "journey"]
    owner_id: UUID | None
    journey_kind: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    memory_boundary_message_id: UUID | None = None


class ThreadMessagesResponse(BaseModel):
    thread: ThreadInfoResponse
    latest_run: dict[str, Any] | None
    messages: list[MessageResponse]
    tool_calls: list[ToolCallResponse]


class ThreadRuntimeItemResponse(BaseModel):
    id: UUID
    project_id: UUID
    thread_type: Literal["agent", "subAgent", "journey"]
    owner_id: UUID | None
    journey_kind: str | None
    status: str
    last_error: str | None
    updated_at: datetime
    latest_run_id: UUID | None
    latest_run_status: str | None
    latest_message_at: datetime | None
    unresolved_tool_call_count: int


class ProjectThreadRuntimeResponse(BaseModel):
    threads: list[ThreadRuntimeItemResponse]


class ToolCallDecisionResponse(BaseModel):
    tool_call: ToolCallResponse


class ToolCallBatchDecisionResponse(BaseModel):
    results: list[ToolCallDecisionResponse]

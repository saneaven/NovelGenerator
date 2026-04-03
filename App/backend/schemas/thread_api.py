from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from .assets import ImageRunResponse
from .mcp import McpSelection


class StartRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_text: str = ""
    input_payload: dict[str, Any] | None = None
    run_mode: Literal["planMode", "agentMode"] | None = None
    surface: str | None = None
    context_object_ids: list[UUID] = Field(default_factory=list)
    journey_target_ids: list[UUID] = Field(default_factory=list)
    language: str | None = None
    mcp_selections: list[McpSelection] = Field(default_factory=list)


class ResumeRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_mode: Literal["planMode", "agentMode"] | None = None
    surface: str | None = None
    context_object_ids: list[UUID] = Field(default_factory=list)
    journey_target_ids: list[UUID] = Field(default_factory=list)
    language: str | None = None


class ThreadRunResponse(BaseModel):
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
    pause_after_apply: bool = False


class CreateJourneyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal[
        "manuscriptEdit",
        "outlineEdit",
        "objectEdit",
        "objectTranslation",
        "imagePrompt",
        "sceneImagePrompt",
        "messageTranslation",
    ]
    display_label: str | None = None
    input_text: str = ""
    input_payload: dict[str, Any] | None = None
    run_mode: Literal["planMode", "agentMode"] | None = None
    surface: str | None = None
    context_object_ids: list[UUID] = Field(default_factory=list)
    journey_target_ids: list[UUID] = Field(default_factory=list)
    language: str | None = None
    mcp_selections: list[McpSelection] = Field(default_factory=list)


class MessageAttachmentResponse(BaseModel):
    id: UUID
    message_id: UUID
    sort_order: int
    kind: Literal["image", "document", "text_file"]
    mime_type: str
    original_filename: str
    file_size: int
    url: str
    width: int | None = None
    height: int | None = None
    created_at: datetime


class MessageResponse(BaseModel):
    id: UUID
    thread_id: UUID
    run_id: UUID
    role: Literal["system", "user", "assistant", "tool_call"]
    seq: int
    seq_in_thread: int
    data: dict[str, Any]
    attachments: list[MessageAttachmentResponse] = Field(default_factory=list)
    created_at: datetime


class PatchContentPart(BaseModel):
    type: Literal["content"]
    text: str


class PatchMessageRequest(BaseModel):
    language: str
    content_parts: list[PatchContentPart]
    reasoning_detail: dict[str, Any] | None = None


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
    image_run_id: UUID | None
    child_thread_id: UUID | None
    accepted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ThreadInfoResponse(BaseModel):
    id: UUID
    project_id: UUID
    thread_type: Literal["agent", "subAgent", "journey"]
    parent_id: UUID
    journey_kind: str | None
    display_label: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    memory_boundary_message_id: UUID | None = None


class ThreadMessagesResponse(BaseModel):
    thread: ThreadInfoResponse
    latest_run: dict[str, Any] | None
    messages: list[MessageResponse]
    tool_calls: list[ToolCallResponse]
    image_runs: list[ImageRunResponse]


class ThreadRuntimeItemResponse(BaseModel):
    id: UUID
    project_id: UUID
    thread_type: Literal["agent", "subAgent", "journey"]
    parent_id: UUID
    journey_kind: str | None
    display_label: str | None = None
    status: str
    last_error: str | None
    updated_at: datetime
    latest_run_id: UUID | None
    latest_run_status: str | None
    latest_message_at: datetime | None
    unresolved_tool_call_count: int


class ProjectThreadRuntimeResponse(BaseModel):
    threads: list[ThreadRuntimeItemResponse]


class JourneyListResponse(BaseModel):
    items: list["JourneyResponse"]


class CreateJourneyResponse(BaseModel):
    journey_id: UUID
    thread_id: UUID
    run_id: UUID
    status: str


class DeleteAllJourneysResponse(BaseModel):
    deleted: int


class JourneyResponse(BaseModel):
    journey_id: UUID
    project_id: UUID
    thread_id: UUID
    latest_run_id: UUID | None
    latest_message_at: datetime | None
    kind: str
    display_label: str
    status: str
    last_error: str | None
    updated_at: datetime


class ToolCallDecisionResponse(BaseModel):
    tool_call: ToolCallResponse


class ToolCallBatchDecisionResponse(BaseModel):
    results: list[ToolCallDecisionResponse]

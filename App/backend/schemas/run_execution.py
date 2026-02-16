from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


RunType = Literal["agent", "subAgent", "journey"]
RunStatus = Literal["running", "waiting", "paused", "completed", "error", "cancelled"]
RunMode = Literal["planMode", "agentMode"]
RunSurface = Literal["story-object", "outline-manager", "novel-editor", "config"]
JourneyKind = Literal["aiEdit", "translation", "imagePrompt"]
RunToolDecision = Literal["accept", "reject"]


class AgentRunStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_type: Literal["agent"]
    agent_id: UUID
    run_mode: RunMode
    surface: RunSurface
    input_text: str = ""
    language: str
    context_object_ids: list[str] = Field(default_factory=list)


class JourneyRunStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_type: Literal["journey"]
    journey_kind: JourneyKind
    input_text: str = ""
    language: str
    input_payload: dict[str, Any] = Field(default_factory=dict)
    journey_target_ids: list[str] = Field(default_factory=list)


StartRunRequest = Annotated[AgentRunStart | JourneyRunStart, Field(discriminator="run_type")]


class RunDecisionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: UUID
    decisions: dict[str, RunToolDecision] = Field(default_factory=dict)
    options: dict[str, Any] | None = None


class AppendRunMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    language: str


class QueryRunsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_types: list[RunType] = Field(default_factory=list)
    statuses: list[RunStatus] = Field(default_factory=list)
    limit: int = Field(default=50, ge=1, le=500)


class RunMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    seq: int
    role: str
    data: dict[str, Any]
    created_at: datetime


class RunToolCallResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    message_id: UUID
    call_seq: int
    llm_call_id: str
    tool_name: str
    arguments: dict[str, Any]
    status: str
    failure_type: str | None = None
    reason: str | None = None
    result: dict[str, Any] | None = None
    accepted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    project_id: UUID
    run_type: RunType
    status: RunStatus
    language: str

    input_text: str
    input_payload: dict[str, Any]
    final_output: str | None = None
    error: str | None = None

    agent_id: UUID | None = None
    sub_agent_id: UUID | None = None

    run_mode: RunMode | None = None
    surface: RunSurface | None = None
    context_object_ids: list[str]

    journey_kind: JourneyKind | None = None
    journey_target_ids: list[str]

    parent_run_id: UUID | None = None
    parent_run_message_id: UUID | None = None
    parent_run_tool_call_id: str | None = None

    root_run_seq: int | None = None
    next_message_seq: int

    frozen_context: dict[str, Any] | None = None

    created_at: datetime
    updated_at: datetime


class RunQueryResponse(BaseModel):
    items: list[RunResponse]


class RunStateResponse(BaseModel):
    run: RunResponse


class StartRunResponse(BaseModel):
    run_id: UUID

"""Schemas for unified run runtime APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator


RunKind = Literal["root", "child"]
RunCaller = Literal["planMode", "agentMode", "subAgent"]
RunStatus = Literal["running", "waiting", "paused", "completed", "error", "cancelled"]
RunMode = Literal["planMode", "agentMode"]
RunSurface = Literal["story-object", "outline-manager", "novel-editor", "config"]

RunRole = Literal["user", "assistant", "system"]
ToolCallStatus = Literal["pending", "running", "accepted", "rejected", "failed"]
ToolCallFailureType = Literal["validation", "execution", "partial"]


class CreateRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_kind: RunKind
    caller: RunCaller
    language: str = Field(..., min_length=1, max_length=50)
    input_text: str = ""

    # Root run
    run_mode: Optional[RunMode] = None
    surface: Optional[RunSurface] = None
    context_object_ids: List[str] = Field(default_factory=list)

    # Child run
    parent_run_id: Optional[uuid.UUID] = None
    parent_run_message_id: Optional[uuid.UUID] = None
    parent_run_tool_call_id: Optional[str] = Field(default=None, min_length=1, max_length=255)
    sub_agent_id: Optional[uuid.UUID] = None

    status: RunStatus = "running"

    @model_validator(mode="after")
    def _validate_by_kind(self) -> "CreateRunRequest":
        if self.run_kind == "root":
            if self.run_mode is None:
                raise ValueError("run_mode is required for root run")
            if self.surface is None:
                raise ValueError("surface is required for root run")
            if any([self.parent_run_id, self.parent_run_message_id, self.parent_run_tool_call_id, self.sub_agent_id]):
                raise ValueError("parent_* and sub_agent_id must be empty for root run")
            return self

        # child run
        if not self.parent_run_id:
            raise ValueError("parent_run_id is required for child run")
        if not self.parent_run_message_id:
            raise ValueError("parent_run_message_id is required for child run")
        if not self.parent_run_tool_call_id:
            raise ValueError("parent_run_tool_call_id is required for child run")
        if not self.sub_agent_id:
            raise ValueError("sub_agent_id is required for child run")
        if self.run_mode is not None or self.surface is not None:
            raise ValueError("run_mode/surface must be empty for child run")
        return self


class PatchRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Optional[RunStatus] = None
    final_output: Optional[str] = None
    error: Optional[str] = None


class QueryRunsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    statuses: Optional[List[RunStatus]] = None
    root_only: bool = False
    parent_run_message_ids: List[uuid.UUID] = Field(default_factory=list)
    include_messages: bool = True
    include_tool_calls: bool = True


class AddRunMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: RunRole
    language: str = Field(..., min_length=1, max_length=50)
    content_parts: List[Dict[str, Any]] = Field(default_factory=list)
    thinking_details: Optional[List[Dict[str, Any]]] = None


class PatchRunMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = Field(..., min_length=1, max_length=50)
    content_parts: Optional[List[Dict[str, Any]]] = None
    thinking_details: Optional[List[Dict[str, Any]]] = None


class TranslateRunMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = Field(..., min_length=1, max_length=50)
    content_parts: List[Dict[str, Any]] = Field(default_factory=list)
    thinking_details: Optional[List[Dict[str, Any]]] = None


class UpsertRunToolCallItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    llm_call_id: str = Field(..., min_length=1, max_length=255)
    call_seq: int = Field(..., ge=1)
    tool_name: str = Field(..., min_length=1, max_length=120)
    arguments: Dict[str, Any] = Field(default_factory=dict)
    status: ToolCallStatus = "pending"
    failure_type: Optional[ToolCallFailureType] = None
    reason: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    accepted_at: Optional[datetime] = None


class UpsertRunToolCallsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_calls: List[UpsertRunToolCallItem] = Field(default_factory=list)


class RunToolCallResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    run_id: uuid.UUID
    message_id: uuid.UUID
    llm_call_id: str
    call_seq: int
    tool_name: str
    arguments: Dict[str, Any]
    status: ToolCallStatus
    failure_type: Optional[ToolCallFailureType] = None
    reason: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    accepted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class RunMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    run_id: uuid.UUID
    seq: int
    role: RunRole
    data: Dict[str, Any]
    created_at: datetime
    tool_calls: List[RunToolCallResponse] = Field(default_factory=list)


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    agent_id: uuid.UUID
    run_kind: RunKind
    caller: RunCaller
    status: RunStatus
    language: str
    input_text: str
    final_output: Optional[str] = None
    error: Optional[str] = None
    run_mode: Optional[RunMode] = None
    surface: Optional[RunSurface] = None
    context_object_ids: List[str] = Field(default_factory=list)
    parent_run_id: Optional[uuid.UUID] = None
    parent_run_message_id: Optional[uuid.UUID] = None
    parent_run_tool_call_id: Optional[str] = None
    sub_agent_id: Optional[uuid.UUID] = None
    root_run_seq: Optional[int] = None
    next_message_seq: int
    created_at: datetime
    updated_at: datetime
    messages: List[RunMessageResponse] = Field(default_factory=list)


class CreateRunResponse(BaseModel):
    run: RunResponse


class PatchRunResponse(BaseModel):
    run: RunResponse


class GetRunResponse(BaseModel):
    run: RunResponse


class QueryRunsResponse(BaseModel):
    items: List[RunResponse]


class AddRunMessageResponse(BaseModel):
    message: RunMessageResponse


class PatchRunMessageResponse(BaseModel):
    message: RunMessageResponse


class TranslateRunMessageResponse(BaseModel):
    message: RunMessageResponse


class UpsertRunToolCallsResponse(BaseModel):
    tool_calls: List[RunToolCallResponse]


class TimelineChildRunSummary(BaseModel):
    run_id: uuid.UUID
    parent_run_tool_call_id: str
    status: RunStatus
    final_output: Optional[str] = None


class TimelineItem(BaseModel):
    root_run_id: uuid.UUID
    root_run_seq: int
    status: RunStatus
    messages: List[RunMessageResponse]
    child_runs: List[TimelineChildRunSummary]


class TimelineResponse(BaseModel):
    items: List[TimelineItem]
    next_cursor: Optional[str] = None

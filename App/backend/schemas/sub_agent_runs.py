"""Pydantic schemas for Sub Agent run persistence."""

from __future__ import annotations

from datetime import datetime
import uuid
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ParentType = Literal["agent", "sub_agent"]
SubAgentRunStatus = Literal["running", "waiting", "paused", "completed", "error", "cancelled"]


# ---------------------------------------------------------------------------
# Create Run
# ---------------------------------------------------------------------------

class CreateRunRequest(BaseModel):
    """Create a new Sub Agent run."""
    model_config = ConfigDict(extra="forbid")

    parent_type: ParentType
    parent_id: uuid.UUID
    parent_message_id: uuid.UUID
    parent_tool_call_id: str = Field(..., min_length=1, max_length=255)

    sub_agent_id: uuid.UUID
    agent_name: str = Field(..., min_length=1, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=200)
    caller: str = Field(..., min_length=1, max_length=20)

    language: str = Field(..., min_length=1, max_length=50)
    input: str = Field(default="")
    status: SubAgentRunStatus


# ---------------------------------------------------------------------------
# Patch Run (status, final_output, error only)
# ---------------------------------------------------------------------------

class PatchRunRequest(BaseModel):
    """Partial update for a Sub Agent run."""
    model_config = ConfigDict(extra="forbid")

    status: Optional[SubAgentRunStatus] = None
    final_output: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Add Message
# ---------------------------------------------------------------------------

class AddMessageRequest(BaseModel):
    """Append one message to a Sub Agent run."""
    model_config = ConfigDict(extra="forbid")

    role: str = Field(..., min_length=1, max_length=50)
    content_parts: List[Dict[str, Any]] = Field(default_factory=list)
    tool_calls: Optional[List[Dict[str, Any]]] = None
    thinking_details: Optional[List[Dict[str, Any]]] = None


# ---------------------------------------------------------------------------
# Update Message (tool_calls / thinking_details only)
# ---------------------------------------------------------------------------

class UpdateMessageRequest(BaseModel):
    """Partial update for an existing message."""
    model_config = ConfigDict(extra="forbid")

    tool_calls: Optional[List[Dict[str, Any]]] = None
    thinking_details: Optional[List[Dict[str, Any]]] = None


# ---------------------------------------------------------------------------
# Response Models
# ---------------------------------------------------------------------------

class SubAgentRunMessageResponse(BaseModel):
    """Stored run message."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    run_id: uuid.UUID
    seq: int
    role: str
    content_parts: List[Dict[str, Any]]
    tool_calls: Optional[List[Dict[str, Any]]] = None
    thinking_details: Optional[List[Dict[str, Any]]] = None
    created_at: datetime


class SubAgentRunResponse(BaseModel):
    """Stored run with message history."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    agent_id: uuid.UUID

    parent_type: ParentType
    parent_id: uuid.UUID
    parent_message_id: uuid.UUID
    parent_tool_call_id: str

    sub_agent_id: uuid.UUID
    agent_name: str
    display_name: str
    caller: str

    language: str
    input: str
    status: SubAgentRunStatus
    final_output: Optional[str] = None
    error: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    messages: List[SubAgentRunMessageResponse] = Field(default_factory=list)


class CreateRunResponse(BaseModel):
    """Create run response."""
    run: SubAgentRunResponse


class PatchRunResponse(BaseModel):
    """Patch run response."""
    run: SubAgentRunResponse


class AddMessageResponse(BaseModel):
    """Add message response."""
    message: SubAgentRunMessageResponse


class UpdateMessageResponse(BaseModel):
    """Update message response."""
    message: SubAgentRunMessageResponse


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

class SubAgentRunQueryByMessagesRequest(BaseModel):
    """Query run trees by root agent message IDs."""
    model_config = ConfigDict(extra="forbid")

    message_ids: List[uuid.UUID] = Field(default_factory=list)
    status_filter: Optional[List[SubAgentRunStatus]] = None


class SubAgentRunQueryByMessagesResponse(BaseModel):
    """Query response."""
    items: List[SubAgentRunResponse]

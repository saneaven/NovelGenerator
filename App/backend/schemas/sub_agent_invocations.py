"""Pydantic schemas for Sub Agent invocation persistence."""

from __future__ import annotations

from datetime import datetime
import uuid
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ParentType = Literal["agent", "sub_agent"]


class SubAgentInvocationMessageSnapshot(BaseModel):
    """Incoming message payload for snapshot upsert."""
    model_config = ConfigDict(extra="forbid")

    role: str = Field(..., min_length=1, max_length=50)
    content_parts: List[Dict[str, Any]] = Field(default_factory=list)
    tool_calls: Optional[List[Dict[str, Any]]] = None
    thinking_details: Optional[List[Dict[str, Any]]] = None
    created_at: Optional[datetime] = None


class SubAgentInvocationSnapshotRequest(BaseModel):
    """Upsert snapshot request for one invocation."""
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
    status: str = Field(..., min_length=1, max_length=50)
    final_output: Optional[str] = None
    error: Optional[str] = None

    history: List[SubAgentInvocationMessageSnapshot] = Field(default_factory=list)


class SubAgentInvocationMessageResponse(BaseModel):
    """Stored invocation message."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    invocation_id: uuid.UUID
    seq: int
    role: str
    content_parts: List[Dict[str, Any]]
    tool_calls: Optional[List[Dict[str, Any]]] = None
    thinking_details: Optional[List[Dict[str, Any]]] = None
    created_at: datetime


class SubAgentInvocationResponse(BaseModel):
    """Stored invocation with message history."""
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
    status: str
    final_output: Optional[str] = None
    error: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    messages: List[SubAgentInvocationMessageResponse] = Field(default_factory=list)


class SubAgentInvocationSnapshotResponse(BaseModel):
    """Snapshot upsert response."""
    invocation: SubAgentInvocationResponse


class SubAgentInvocationQueryByMessagesRequest(BaseModel):
    """Query invocation trees by root agent message IDs."""
    model_config = ConfigDict(extra="forbid")

    message_ids: List[uuid.UUID] = Field(default_factory=list)
    status_filter: Optional[List[str]] = Field(default_factory=lambda: ["completed"])


class SubAgentInvocationQueryByMessagesResponse(BaseModel):
    """Query response."""
    items: List[SubAgentInvocationResponse]

"""Agent schemas"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any, List, Literal
from enum import Enum


class ToolCallStatus(str, Enum):
    """Status of a tool call"""
    FAILED = "failed"
    PENDING = "pending"
    RUNNING = "running"
    REJECTED = "rejected"
    ACCEPTED = "accepted"


class ToolCallFailureType(str, Enum):
    """Type of tool call failure"""
    VALIDATION = "validation"
    EXECUTION = "execution"
    PARTIAL = "partial"


class ApplicationResult(BaseModel):
    """Result of applying a tool call"""
    success: bool
    message: str
    error: Optional[str] = None
    objectId: Optional[str] = None
    objectType: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


class ToolCallSchema(BaseModel):
    """Schema for tool call data stored in messages"""
    id: str
    tool_name: str
    arguments: Any
    extra_content: Optional[Dict[str, Any]] = None
    status: ToolCallStatus = ToolCallStatus.PENDING
    reason: Optional[str] = None
    failureType: Optional[ToolCallFailureType] = None
    result: Optional[ApplicationResult] = None
    acceptedAt: Optional[datetime] = None


class ContentPart(BaseModel):
    """A part of message content (content or thinking)"""
    type: Literal["content", "thinking"]
    text: str


class AgentCreate(BaseModel):
    """Create agent request"""
    name: str = Field(..., min_length=1, max_length=255)


class AgentUpdate(BaseModel):
    """Update agent request"""
    name: str = Field(..., min_length=1, max_length=255)


class AgentResponse(BaseModel):
    """Agent response"""
    id: UUID
    project_id: UUID
    name: str
    thread_id: Optional[UUID] = None
    archived_until_message_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

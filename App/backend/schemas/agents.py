"""Agent and message schemas"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any, List, Literal
from enum import Enum


class FunctionCallStatus(str, Enum):
    """Status of a function call"""
    FAILED = "failed"
    PENDING = "pending"
    REJECTED = "rejected"
    ACCEPTED = "accepted"


class FunctionCallFailureType(str, Enum):
    """Type of function call failure"""
    VALIDATION = "validation"
    EXECUTION = "execution"
    PARTIAL = "partial"


class ApplicationResult(BaseModel):
    """Result of applying a function call"""
    success: bool
    message: str
    error: Optional[str] = None
    objectId: Optional[str] = None
    objectType: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


class FunctionCallSchema(BaseModel):
    """Schema for function call data stored in messages"""
    id: str
    function_name: str
    arguments: Any
    status: FunctionCallStatus = FunctionCallStatus.PENDING
    reason: Optional[str] = None
    failureType: Optional[FunctionCallFailureType] = None
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
    created_at: datetime
    updated_at: datetime
    messages: List['MessageResponse'] = []

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content_parts: Optional[List[ContentPart]] = None
    language: str = "English"
    function_calls: Optional[List[Dict[str, Any]]] = None
    thinking_details: Optional[List[Dict[str, Any]]] = None


class MessageUpdate(BaseModel):
    content_parts: Optional[List[ContentPart]] = None
    language: str = "English"
    function_calls: Optional[List[Dict[str, Any]]] = None
    thinking_details: Optional[List[Dict[str, Any]]] = None


class MessageResponse(BaseModel):
    """Message response"""
    id: UUID
    agent_id: UUID
    role: str
    data: Dict[str, Any]  # Multilingual content
    function_calls: Optional[List[Dict[str, Any]]]
    created_at: datetime

    class Config:
        from_attributes = True


class AgentWithMessagesResponse(BaseModel):
    """Agent with messages response"""
    agent: AgentResponse
    messages: List[MessageResponse]


# Update forward references for AgentResponse
AgentResponse.model_rebuild()

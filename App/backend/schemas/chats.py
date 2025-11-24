"""Chat and message schemas"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any, List, Literal


class ContentPart(BaseModel):
    """A part of message content (content or thinking)"""
    type: Literal["content", "thinking"]
    text: str


class ChatCreate(BaseModel):
    """Create chat request"""
    name: str = Field(..., min_length=1, max_length=255)


class ChatUpdate(BaseModel):
    """Update chat request"""
    name: str = Field(..., min_length=1, max_length=255)


class ChatResponse(BaseModel):
    """Chat response"""
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
    chat_id: UUID
    role: str
    data: Dict[str, Any]  # Multilingual content
    function_calls: Optional[List[Dict[str, Any]]]
    created_at: datetime

    class Config:
        from_attributes = True


class ChatWithMessagesResponse(BaseModel):
    """Chat with messages response"""
    chat: ChatResponse
    messages: List[MessageResponse]


# Update forward references for ChatResponse
ChatResponse.model_rebuild()

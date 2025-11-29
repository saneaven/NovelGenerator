"""Manuscript schemas (chapter content)"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any, List


class ManuscriptCreate(BaseModel):
    """Create manuscript content"""
    content: str
    language: str = "English"
    userRequest: str = "Initial creation"


class ManuscriptUpdate(BaseModel):
    """Update manuscript content"""
    content: str
    language: str = "English"
    userRequest: str = "Content update"
    create_new_version: bool = True  # If False, updates existing active version instead of creating new one


class ManuscriptVersionResponse(BaseModel):
    """Manuscript version response"""
    id: UUID
    manuscript_id: UUID
    userRequest: str = Field(alias="user_request")
    isActive: bool = Field(alias="is_active")
    data: Dict[str, Any]  # { "English": { "content": "...", "wordCount": 123 } }
    timestamp: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


class ManuscriptResponse(BaseModel):
    """Manuscript response"""
    id: UUID
    chapter_id: UUID
    active_version_id: Optional[UUID]
    created_at: datetime
    updated_at: datetime
    versions: List[ManuscriptVersionResponse] = []

    class Config:
        from_attributes = True


class ManuscriptDataResponse(BaseModel):
    """Manuscript data for a specific language"""
    content: str
    wordCount: int

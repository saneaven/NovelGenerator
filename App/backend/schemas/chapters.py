"""Chapter content schemas"""
from pydantic import BaseModel
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any, List


class ChapterContentCreate(BaseModel):
    """Create chapter content"""
    content: str
    language: str = "English"
    userRequest: str = "Initial creation"


class ChapterContentUpdate(BaseModel):
    """Update chapter content"""
    content: str
    language: str = "English"
    userRequest: str = "Content update"


class ChapterContentVersionResponse(BaseModel):
    """Chapter content version response"""
    id: UUID
    chapter_content_id: UUID
    userRequest: str
    isActive: bool
    data: Dict[str, Any]  # { "English": { "content": "...", "wordCount": 123 } }
    timestamp: datetime

    class Config:
        from_attributes = True


class ChapterContentResponse(BaseModel):
    """Chapter content response"""
    id: UUID
    chapter_id: UUID
    active_version_id: Optional[UUID]
    created_at: datetime
    updated_at: datetime
    versions: List[ChapterContentVersionResponse] = []

    class Config:
        from_attributes = True


class ChapterContentDataResponse(BaseModel):
    """Chapter content data for a specific language"""
    content: str
    wordCount: int

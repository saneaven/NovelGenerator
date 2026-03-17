"""Common schemas shared across different entities"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Dict, Any


class LanguageData(BaseModel):
    """Multilingual data structure"""
    data: Dict[str, Any]  # { "English": {...}, "Korean": {...} }


class VersionBase(BaseModel):
    """Base version information"""
    versionId: UUID
    timestamp: datetime
    userRequest: str
    data: Dict[str, Any]  # Multilingual data
    isActive: bool

    class Config:
        from_attributes = True


class BaseMetadata(BaseModel):
    """Base metadata for canonical project objects."""
    id: UUID
    createdAt: datetime = Field(alias='created_at')
    updatedAt: datetime = Field(alias='updated_at')

    class Config:
        from_attributes = True
        populate_by_name = True

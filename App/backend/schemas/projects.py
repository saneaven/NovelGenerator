"""Project schemas"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional

from .assets import AssetResponse


class ProjectCreate(BaseModel):
    """Create project request"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    main_language: str = Field(default="en", description="Main language for the project's basic_info")


class ProjectUpdate(BaseModel):
    """Update project request"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None


class ProjectResponse(BaseModel):
    """Project response"""
    id: UUID
    user_id: UUID
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    cover_asset: Optional[AssetResponse] = None  # From BasicInfo's cover image

    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    """List of projects response"""
    projects: list[ProjectResponse]
    total: int

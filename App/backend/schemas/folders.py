"""Pydantic schemas for prompt folder management"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FolderCreate(BaseModel):
    """Create a new folder"""
    name: str = Field(..., min_length=1, max_length=100)
    parent_id: Optional[str] = None


class FolderRename(BaseModel):
    """Rename a folder"""
    name: str = Field(..., min_length=1, max_length=100)


class FolderMoveRequest(BaseModel):
    """Move a folder to a new parent"""
    new_parent_id: Optional[str] = None


class FolderResponse(BaseModel):
    """Folder details response"""
    id: str
    name: str
    path: str
    parent_id: Optional[str]
    created_at: datetime
    updated_at: datetime

"""Pydantic schemas for prompt fragment management"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class FragmentIdentifier(BaseModel):
    """Identifier for a specific fragment"""
    folder_id: Optional[str] = None
    fragment_name: str = Field(..., min_length=1, max_length=100)


class FragmentContentResponse(BaseModel):
    """Response with active fragment content"""
    id: str
    folder_id: Optional[str]
    folder_path: Optional[str]  # Computed path for display
    fragment_name: str
    content: str
    description: Optional[str]
    version_number: int
    is_system_default: bool
    created_at: datetime
    updated_at: datetime


class FragmentCreate(BaseModel):
    """Create new fragment. Provide folder_id OR folder_path (resolved to folder_id server-side)."""
    folder_id: Optional[str] = None
    folder_path: Optional[str] = Field(None, max_length=200)  # Alternative: resolved via get_or_create
    fragment_name: str = Field(..., min_length=1, max_length=100)
    content: str = Field(..., min_length=1)
    description: Optional[str] = Field(None, max_length=500)
    note: Optional[str] = Field(None, max_length=500)


class FragmentUpdate(BaseModel):
    """Update fragment (creates new version)"""
    content: str = Field(..., min_length=1)
    description: Optional[str] = Field(None, max_length=500)
    note: Optional[str] = Field(None, max_length=500)


class FragmentMoveRequest(BaseModel):
    """Request to move fragment to different folder"""
    new_folder_id: Optional[str] = None


class FragmentVersionResponse(BaseModel):
    """Full fragment version details"""
    id: str
    folder_id: Optional[str]
    folder_path: Optional[str]  # Computed path for display
    fragment_name: str
    content: str
    description: Optional[str]
    version_number: int
    is_system_default: bool
    created_at: datetime
    updated_at: datetime
    note: Optional[str]


class FragmentVersionHistoryItem(BaseModel):
    """Abbreviated version info for history list"""
    version_number: int
    created_at: datetime
    note: Optional[str]
    is_system_default: bool
    preview: str  # First 200 characters

    class Config:
        from_attributes = True


class FragmentRestoreRequest(BaseModel):
    """Request to restore a specific version"""
    version_number: int = Field(..., ge=1)


class FragmentListItem(BaseModel):
    """Fragment item for list responses"""
    id: str
    folder_id: Optional[str]
    folder_path: Optional[str]  # Computed path for display
    fragment_name: str
    description: Optional[str]
    is_system_default: bool
    version_number: int
    updated_at: datetime


class FragmentWithContent(BaseModel):
    """Fragment with content for template engine"""
    id: str
    folder_id: Optional[str]
    folder_path: Optional[str]  # Computed path for display
    fragment_name: str
    content: str
    description: Optional[str]
    is_system_default: bool


class FolderTreeNode(BaseModel):
    """Node in folder tree structure"""
    id: str
    name: str
    path: str  # Full computed path
    parent_id: Optional[str]
    fragments: List[FragmentListItem]
    children: List['FolderTreeNode']


# Allow forward reference for recursive type
FolderTreeNode.model_rebuild()


class FragmentTreeResponse(BaseModel):
    """Root response for folder tree"""
    root_fragments: List[FragmentListItem]  # Fragments without folder
    folders: List[FolderTreeNode]


class FragmentValidationRequest(BaseModel):
    """Request to validate fragment content"""
    content: str = Field(..., min_length=1)


class FragmentValidationResponse(BaseModel):
    """Validation result for fragment content"""
    is_valid: bool
    syntax_errors: List[str]
    warnings: List[str]
    referenced_fragments: List[str]  # Paths of fragments referenced via {{ prompt("...") }}

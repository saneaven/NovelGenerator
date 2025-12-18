"""Pydantic schemas for prompt fragment management"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class FragmentIdentifier(BaseModel):
    """Identifier for a specific fragment"""
    folder_path: Optional[str] = Field(None, max_length=200)
    fragment_name: str = Field(..., min_length=1, max_length=100)


class FragmentContentResponse(BaseModel):
    """Response with active fragment content"""
    id: str
    folder_path: Optional[str]
    fragment_name: str
    content: str
    description: Optional[str]
    version_number: int
    is_system_default: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FragmentCreate(BaseModel):
    """Create new fragment"""
    folder_path: Optional[str] = Field(None, max_length=200)
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
    new_folder_path: Optional[str] = Field(None, max_length=200)


class FragmentVersionResponse(BaseModel):
    """Full fragment version details"""
    id: str
    folder_path: Optional[str]
    fragment_name: str
    content: str
    description: Optional[str]
    version_number: int
    is_active: bool
    is_system_default: bool
    created_at: datetime
    updated_at: datetime
    note: Optional[str]

    class Config:
        from_attributes = True


class FragmentVersionHistoryItem(BaseModel):
    """Abbreviated version info for history list"""
    version_number: int
    created_at: datetime
    note: Optional[str]
    is_active: bool
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
    folder_path: Optional[str]
    fragment_name: str
    description: Optional[str]
    is_system_default: bool
    version_number: int
    updated_at: datetime

    class Config:
        from_attributes = True


class FragmentWithContent(BaseModel):
    """Fragment with content for template engine"""
    id: str
    folder_path: Optional[str]
    fragment_name: str
    content: str
    description: Optional[str]
    is_system_default: bool

    class Config:
        from_attributes = True


class FolderTreeNode(BaseModel):
    """Node in folder tree structure"""
    name: str
    path: Optional[str]  # Full path, None for root
    fragments: List[FragmentListItem]
    children: List['FolderTreeNode']

    class Config:
        from_attributes = True


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
    referenced_fragments: List[str]  # Paths of fragments referenced via {{prompt ...}}

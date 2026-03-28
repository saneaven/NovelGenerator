"""Schemas for canonical project objects."""
from pydantic import BaseModel, Field
from uuid import UUID
from typing import Optional, Dict, Any, List, Literal
from .common import BaseMetadata, VersionBase


RichTextFormat = Literal["tiptap", "markdown", "tree"]


# ============================================================================
# Basic Info
# ============================================================================

class BasicInfoCreate(BaseModel):
    """Create basic info"""
    title: str
    logline: str
    genres: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    language: str = "English"


class BasicInfoUpdate(BaseModel):
    """Update basic info"""
    title: Optional[str] = None
    logline: Optional[str] = None
    genres: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    language: Optional[str] = None


class BasicInfoResponse(BaseMetadata):
    """Basic info response"""
    project_id: UUID
    title: Optional[str]
    logline: Optional[str]
    genres: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)


# ============================================================================
# Name/Description Objects (Character, Organization, Location, Lorebook)
# ============================================================================

class NameDescriptionCreate(BaseModel):
    """Create name/description object"""
    name: str = Field(..., max_length=255)
    description: str = ""  # One-line summary for object indexes
    content: Any  # Full content projection
    language: str = "English"
    rich_text_format: Literal["tiptap", "markdown"] = "tiptap"


class NameDescriptionUpdate(BaseModel):
    """Update name/description object"""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None  # One-line summary for object indexes
    content: Optional[Any] = None  # Full content projection
    language: Optional[str] = None
    rich_text_format: Optional[Literal["tiptap", "markdown"]] = None


class NameDescriptionResponse(BaseMetadata):
    """Name/description object response"""
    project_id: UUID
    name: Optional[str]
    description: Optional[str]  # One-line summary for object indexes
    content: Optional[Any]  # Full content projection
    # Image prompts (stored on base object, not versioned)
    image_prompt: Optional[str] = None
    image_prompt_positive: Optional[str] = None
    image_prompt_negative: Optional[str] = None


class ImagePromptUpdate(BaseModel):
    """Update image prompts for a project object."""
    image_prompt: Optional[str] = None
    image_prompt_positive: Optional[str] = None
    image_prompt_negative: Optional[str] = None


# ============================================================================
# Outline
# ============================================================================

class OutlineCreate(BaseModel):
    """Create outline item"""
    name: str = Field(..., max_length=255)
    description: str = ""  # One-line summary for object indexes
    content: Any  # Full content projection
    kind: str
    parent_id: Optional[UUID] = None
    position: int = 0
    language: str = "English"
    rich_text_format: Literal["tiptap", "markdown"] = "tiptap"


class OutlineUpdate(BaseModel):
    """Update outline item"""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None  # One-line summary for object indexes
    content: Optional[Any] = None  # Full content projection
    parent_id: Optional[UUID] = None
    position: Optional[int] = None
    language: Optional[str] = None
    rich_text_format: Optional[Literal["tiptap", "markdown"]] = None


class OutlineResponse(BaseMetadata):
    """Outline item response"""
    project_id: UUID
    kind: str
    parent_id: Optional[UUID]
    name: Optional[str]
    description: Optional[str]  # One-line summary for object indexes
    content: Optional[Any]  # Full content projection
    position: int
    manuscript_id: Optional[UUID] = None


# ============================================================================
# Version Management
# ============================================================================

class VersionCreate(BaseModel):
    """Create new version"""
    userRequest: str
    data: Dict[str, Any]  # Multilingual data


class VersionResponse(VersionBase):
    """Version response"""
    id: UUID
    object_id: UUID
    object_type: str


class VersionListResponse(BaseModel):
    """List of versions"""
    versions: List[VersionResponse]
    total: int

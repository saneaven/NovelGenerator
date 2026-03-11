"""Story object schemas"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any, List
from .common import BaseMetadata, VersionBase


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
    content: str  # Full content
    language: str = "English"


class NameDescriptionUpdate(BaseModel):
    """Update name/description object"""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None  # One-line summary for object indexes
    content: Optional[str] = None  # Full content
    language: Optional[str] = None


class NameDescriptionResponse(BaseMetadata):
    """Name/description object response"""
    project_id: UUID
    name: Optional[str]
    description: Optional[str]  # One-line summary for object indexes
    content: Optional[str]  # Full content
    # Image prompts (stored on base object, not versioned)
    image_prompt: Optional[str] = None
    image_prompt_positive: Optional[str] = None
    image_prompt_negative: Optional[str] = None


class ImagePromptUpdate(BaseModel):
    """Update image prompts for a story object"""
    image_prompt: Optional[str] = None
    image_prompt_positive: Optional[str] = None
    image_prompt_negative: Optional[str] = None


# ============================================================================
# Outline, Act, Chapter
# ============================================================================

class ChapterCreate(BaseModel):
    """Create chapter"""
    name: str = Field(..., max_length=255)
    description: str = ""  # One-line summary for object indexes
    content: str  # Full content
    order: int
    language: str = "English"


class ChapterUpdate(BaseModel):
    """Update chapter"""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None  # One-line summary for object indexes
    content: Optional[str] = None  # Full content
    order: Optional[int] = None
    language: Optional[str] = None


class ChapterResponse(BaseMetadata):
    """Chapter response"""
    act_id: UUID
    name: Optional[str]
    description: Optional[str]  # One-line summary for object indexes
    content: Optional[str]  # Full content
    order: int


class ActCreate(BaseModel):
    """Create act"""
    name: str = Field(..., max_length=255)
    description: str = ""  # One-line summary for object indexes
    content: str  # Full content
    order: int
    language: str = "English"


class ActUpdate(BaseModel):
    """Update act"""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None  # One-line summary for object indexes
    content: Optional[str] = None  # Full content
    order: Optional[int] = None
    language: Optional[str] = None


class ActResponse(BaseMetadata):
    """Act response"""
    outline_id: UUID
    name: Optional[str]
    description: Optional[str]  # One-line summary for object indexes
    content: Optional[str]  # Full content
    order: int
    chapters: List[ChapterResponse] = []


class OutlineCreate(BaseModel):
    """Create outline"""
    pass


class OutlineResponse(BaseMetadata):
    """Outline response"""
    project_id: UUID
    acts: List[ActResponse] = []


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

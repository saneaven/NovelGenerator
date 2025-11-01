"""Pydantic schemas for prompt management"""
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class PromptIdentifier(BaseModel):
    """Identifier for a specific prompt"""
    function_type: str = Field(..., min_length=1, max_length=50)
    prompt_category: str = Field(..., min_length=1, max_length=50)
    prompt_name: Optional[str] = Field(None, max_length=50)


class PromptContentResponse(BaseModel):
    """Response with active prompt content"""
    content: str
    version_number: int
    created_at: datetime
    is_default: bool = False

    class Config:
        from_attributes = True


class PromptVersionCreate(BaseModel):
    """Create new prompt version"""
    content: str = Field(..., min_length=1)
    note: Optional[str] = Field(None, max_length=500)


class PromptVersionResponse(BaseModel):
    """Full prompt version details"""
    id: str
    version_number: int
    content: str
    is_active: bool
    is_default: bool
    created_at: datetime
    note: Optional[str]

    class Config:
        from_attributes = True


class VersionHistoryItem(BaseModel):
    """Abbreviated version info for history list"""
    version_number: int
    created_at: datetime
    note: Optional[str]
    is_active: bool
    is_default: bool
    preview: str  # First 200 characters

    class Config:
        from_attributes = True


class ValidationError(BaseModel):
    """Validation error details"""
    line: Optional[int]
    column: Optional[int]
    message: str
    severity: str = "error"  # "error" or "warning"


class ValidationResult(BaseModel):
    """Template validation result"""
    valid: bool
    errors: List[ValidationError] = []
    warnings: List[ValidationError] = []


class PromptValidationRequest(BaseModel):
    """Request to validate prompt template"""
    content: str


class PromptRestoreRequest(BaseModel):
    """Request to restore a specific version"""
    version_number: int = Field(..., ge=1)


class SyntaxCatalogEntry(BaseModel):
    """Describes a variable/context/conditional available in templates."""
    name: str
    description: Optional[str] = None
    type: Optional[str] = None
    source: Optional[str] = None
    example: Optional[str] = None
    default: Optional[Any] = None
    supports_negation: Optional[bool] = None


class SyntaxCatalog(BaseModel):
    """Catalog of the available placeholders grouped by type."""
    variables: List[SyntaxCatalogEntry] = Field(default_factory=list)
    contexts: List[SyntaxCatalogEntry] = Field(default_factory=list)
    conditionals: List[SyntaxCatalogEntry] = Field(default_factory=list)


class TemplatePlaceholderInfo(BaseModel):
    """Details how a placeholder is used within a template."""
    name: str
    required: bool = False
    description: Optional[str] = None
    type: Optional[str] = None
    source: Optional[str] = None
    example: Optional[str] = None
    default: Optional[Any] = None
    supports_negation: Optional[bool] = None


class TemplatePlaceholderGroup(BaseModel):
    """Grouped placeholders for a template."""
    variables: List[TemplatePlaceholderInfo] = Field(default_factory=list)
    contexts: List[TemplatePlaceholderInfo] = Field(default_factory=list)
    conditionals: List[TemplatePlaceholderInfo] = Field(default_factory=list)


class TemplateSyntaxInfo(BaseModel):
    """Template metadata describing which placeholders it expects."""
    id: Optional[str] = None
    function_type: Optional[str] = None
    category: Optional[str] = None
    variant: Optional[str] = None
    description: Optional[str] = None
    placeholders: TemplatePlaceholderGroup = Field(default_factory=TemplatePlaceholderGroup)


class PromptSyntaxMetadata(BaseModel):
    """Response payload for syntax helper metadata."""
    version: Optional[str] = None
    catalog: SyntaxCatalog = Field(default_factory=SyntaxCatalog)
    templates: List[TemplateSyntaxInfo] = Field(default_factory=list)

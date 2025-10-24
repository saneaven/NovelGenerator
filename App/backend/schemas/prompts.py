"""Pydantic schemas for prompt management"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


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

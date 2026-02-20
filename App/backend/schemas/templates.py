"""Pydantic schemas for template rendering and validation"""
from typing import Any, Optional

from pydantic import BaseModel, Field


class TemplateRenderRequest(BaseModel):
    """Request to render a Jinja2 template"""
    template_content: str = Field(..., description="Jinja2 template string to render")
    data: dict[str, Any] = Field(default_factory=dict, description="Template variable data")


class TemplateRenderResponse(BaseModel):
    """Response from template rendering"""
    rendered: str = ""
    error: Optional[str] = None


class TemplateValidateRequest(BaseModel):
    """Request to validate Jinja2 template syntax"""
    template_content: str = Field(..., description="Jinja2 template string to validate")


class TemplateValidateResponse(BaseModel):
    """Response from template validation"""
    is_valid: bool
    error: Optional[str] = None

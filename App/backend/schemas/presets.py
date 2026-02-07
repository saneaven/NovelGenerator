"""Pydantic schemas for prompt preset management."""
from datetime import datetime
from typing import List, Optional, Union, Dict, Any, Literal

from pydantic import BaseModel, Field, ConfigDict

from .sub_agents import SubAgentDefinition


class PresetCreate(BaseModel):
    """Create new preset"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    initialize_with_defaults: bool = Field(True, description="Create with default prompts and fragments")


class PresetUpdate(BaseModel):
    """Update preset metadata"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class PresetDuplicateRequest(BaseModel):
    """Request to duplicate a preset"""
    new_name: str = Field(..., min_length=1, max_length=100)
    new_description: Optional[str] = Field(None, max_length=500)


class PresetListItem(BaseModel):
    """Preset item for list responses"""
    id: str
    name: str
    description: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PresetResponse(BaseModel):
    """Full preset details"""
    id: str
    name: str
    description: Optional[str]
    prompt_count: int
    fragment_count: int
    variable_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PresetDetailResponse(BaseModel):
    """Preset with full details including active status"""
    id: str
    name: str
    description: Optional[str]
    is_active: bool
    prompt_count: int
    fragment_count: int
    variable_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ActivePresetResponse(BaseModel):
    """Response for active preset info"""
    id: str
    name: str
    description: Optional[str]

    class Config:
        from_attributes = True


# --- Export/Import Schemas ---

class ExportPromptData(BaseModel):
    """Single prompt content for export"""
    model_config = ConfigDict(extra="forbid")
    content: str


class ExportFragmentData(BaseModel):
    """Single fragment data for export"""
    model_config = ConfigDict(extra="forbid")
    content: str
    description: Optional[str] = None


class ExportVariableData(BaseModel):
    """Single variable data for export"""
    model_config = ConfigDict(extra="forbid")
    name: str
    var_type: str
    value: Union[str, int, float, bool, None]
    select_options: Optional[List[str]] = None
    number_options: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    display_order: int


class PresetExportData(BaseModel):
    """Complete preset export structure"""
    model_config = ConfigDict(extra="forbid")
    format_version: Literal[1]
    preset: Dict[str, Optional[str]]
    prompts: Dict[str, Any]
    fragments: Dict[str, Dict[str, ExportFragmentData]]
    variables: List[ExportVariableData]
    sub_agents: List[SubAgentDefinition]
    exported_at: str


class PresetImportData(BaseModel):
    """Request to import a preset from exported JSON"""
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    data: PresetExportData

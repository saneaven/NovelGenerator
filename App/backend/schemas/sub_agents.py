"""Pydantic schemas for Sub Agents (per prompt preset)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SubAgentDefinition(BaseModel):
    """Sub Agent definition stored per preset."""

    sub_agent_id: str = Field(..., min_length=1, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    enabled: bool = True

    allowed_agent_modes: List[str]
    allowed_tool_names: List[str]

    # TaskAIConfig-like JSON payload (provider/model/temp/thinking settings etc.)
    llm_config: Dict[str, Any]

    class Config:
        from_attributes = True


class SubAgentCreate(SubAgentDefinition):
    """Create a new sub agent."""


class SubAgentUpdate(BaseModel):
    """Update an existing sub agent."""

    display_name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    enabled: Optional[bool] = None

    allowed_agent_modes: Optional[List[str]] = None
    allowed_tool_names: Optional[List[str]] = None
    llm_config: Optional[Dict[str, Any]] = None

"""Pydantic schemas for Sub Agents (per prompt preset)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, ConfigDict
import uuid


class SubAgentDefinition(BaseModel):
    """Sub Agent definition stored per preset."""
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: uuid.UUID
    agent_name: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]{0,49}$")
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=2000)
    enabled: bool = True

    allowed_invocation_modes: List[str]
    # Static tool names only (create_*/read_*/patch_*/replace_* etc). Never store call_* here.
    allowed_tool_names: List[str]
    # UUID list of other Sub Agents that this Sub Agent is allowed to call.
    allowed_sub_agent_ids: List[uuid.UUID]

    # TaskAIConfig-like JSON payload (provider/model/temp/thinking settings etc.)
    llm_config: Dict[str, Any]

class SubAgentCreate(BaseModel):
    """Create a new sub agent."""
    model_config = ConfigDict(extra="forbid")

    agent_name: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]{0,49}$")
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=2000)
    enabled: bool = True

    allowed_invocation_modes: List[str]
    allowed_tool_names: List[str]
    allowed_sub_agent_ids: List[uuid.UUID]

    llm_config: Dict[str, Any]


class SubAgentUpdate(BaseModel):
    """Update an existing sub agent."""
    model_config = ConfigDict(extra="forbid")

    agent_name: Optional[str] = Field(None, min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]{0,49}$")
    display_name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, min_length=1, max_length=2000)
    enabled: Optional[bool] = None

    allowed_invocation_modes: Optional[List[str]] = None
    allowed_tool_names: Optional[List[str]] = None
    allowed_sub_agent_ids: Optional[List[uuid.UUID]] = None
    llm_config: Optional[Dict[str, Any]] = None

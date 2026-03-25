"""Pydantic schemas for Sub Agents (per prompt preset)."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict
import uuid

from .settings import TaskAIConfig
from ..services.tool_engine.grant_catalog import FeatureKey, ToolCategory


class SubAgentPromptTemplates(BaseModel):
    """Optional prompt payload used when creating a new Sub Agent."""

    system_prompt: Optional[str] = Field(None, min_length=1)
    user_prompt: Optional[str] = Field(None, min_length=1)


class SubAgentToolGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feature_key: FeatureKey
    categories: List[ToolCategory]


class SubAgentToolGrantCatalogItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feature_key: FeatureKey
    display_name: str = Field(..., min_length=1, max_length=200)
    supported_categories: List[ToolCategory]


class SubAgentDefinition(BaseModel):
    """Sub Agent definition stored per preset."""
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: uuid.UUID
    agent_name: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]{0,49}$")
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=2000)
    enabled: bool = True

    allowed_invocation_modes: List[str]
    tool_grants: List[SubAgentToolGrant]
    # UUID list of other Sub Agents that this Sub Agent is allowed to call.
    allowed_sub_agent_ids: List[uuid.UUID]
    allowed_mcp_server_ids: List[uuid.UUID]

    # If true, use llm_config_override for this Sub Agent; otherwise inherit the global config.
    use_custom_llm_config: bool = False

    # TaskAIConfig-like payload used when use_custom_llm_config=true.
    llm_config_override: Optional[TaskAIConfig] = None


class SubAgentCreate(BaseModel):
    """Create a new sub agent."""
    model_config = ConfigDict(extra="forbid")

    agent_name: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]{0,49}$")
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=2000)
    enabled: bool = True

    allowed_invocation_modes: List[str]
    tool_grants: List[SubAgentToolGrant]
    allowed_sub_agent_ids: List[uuid.UUID]
    allowed_mcp_server_ids: List[uuid.UUID]

    use_custom_llm_config: bool = False
    llm_config_override: Optional[TaskAIConfig] = None
    prompt_templates: Optional[SubAgentPromptTemplates] = None


class SubAgentUpdate(BaseModel):
    """Update an existing sub agent."""
    model_config = ConfigDict(extra="forbid")

    agent_name: Optional[str] = Field(None, min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]{0,49}$")
    display_name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, min_length=1, max_length=2000)
    enabled: Optional[bool] = None

    allowed_invocation_modes: Optional[List[str]] = None
    tool_grants: Optional[List[SubAgentToolGrant]] = None
    allowed_sub_agent_ids: Optional[List[uuid.UUID]] = None
    allowed_mcp_server_ids: Optional[List[uuid.UUID]] = None
    use_custom_llm_config: Optional[bool] = None
    llm_config_override: Optional[TaskAIConfig] = None

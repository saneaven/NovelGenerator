"""Pydantic schemas for MCP server management and message selections."""

from __future__ import annotations

from typing import Any, Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class McpHeaderInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=200)
    value: str


class McpAuthNoneInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auth_kind: Literal["none"]


class McpAuthBearerInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auth_kind: Literal["bearer"]
    token: str = Field(..., min_length=1)


class McpAuthHeadersInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auth_kind: Literal["headers"]
    headers: list[McpHeaderInput] = Field(default_factory=list)


McpAuthInput = Annotated[
    McpAuthNoneInput | McpAuthBearerInput | McpAuthHeadersInput,
    Field(discriminator="auth_kind"),
]


class McpCatalogTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    local_name: str
    remote_name: str
    title: str | None = None
    description: str | None = None
    input_schema: dict[str, Any] = Field(default_factory=dict)
    annotations: dict[str, Any] | None = None


class McpCatalogPromptArgument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str | None = None
    required: bool = False


class McpCatalogPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    title: str | None = None
    description: str | None = None
    arguments: list[McpCatalogPromptArgument] = Field(default_factory=list)


class McpCatalogResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uri: str
    name: str | None = None
    title: str | None = None
    description: str | None = None
    mime_type: str | None = None


class McpCatalogSupports(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tools: bool = False
    prompts: bool = False
    resources: bool = False
    resource_templates: bool = False
    roots: bool = False
    elicitation: bool = False
    sampling: bool = False
    tasks: bool = False


class NormalizedMcpCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supports: McpCatalogSupports = Field(default_factory=McpCatalogSupports)
    tools: list[McpCatalogTool] = Field(default_factory=list)
    prompts: list[McpCatalogPrompt] = Field(default_factory=list)
    resources: list[McpCatalogResource] = Field(default_factory=list)
    resource_templates: list[dict[str, Any]] = Field(default_factory=list)


class McpServerSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: str | None = None
    server_info: dict[str, Any] = Field(default_factory=dict)
    capabilities_raw: dict[str, Any] = Field(default_factory=dict)
    catalog: NormalizedMcpCatalog = Field(default_factory=NormalizedMcpCatalog)
    sync_error: str | None = None
    synced_at: str | None = None


class McpServerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server_key: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]{0,63}$")
    display_name: str = Field(..., min_length=1, max_length=200)
    server_url: str = Field(..., min_length=1)
    enabled: bool = True
    allow_agent_mode: bool = True
    allow_plan_mode: bool = True
    auth: McpAuthInput


class McpServerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server_key: str | None = Field(None, min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]{0,63}$")
    display_name: str | None = Field(None, min_length=1, max_length=200)
    server_url: str | None = Field(None, min_length=1)
    enabled: bool | None = None
    allow_agent_mode: bool | None = None
    allow_plan_mode: bool | None = None
    auth: McpAuthInput | None = None


class McpServerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    server_key: str
    display_name: str
    server_url: str
    enabled: bool
    allow_agent_mode: bool
    allow_plan_mode: bool
    auth_kind: Literal["none", "bearer", "headers"]
    snapshot: McpServerSnapshot


class McpSelectionPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selection_id: str = Field(..., min_length=1)
    server_id: UUID
    kind: Literal["prompt"]
    prompt_name: str = Field(..., min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)


class McpSelectionResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selection_id: str = Field(..., min_length=1)
    server_id: UUID
    kind: Literal["resource"]
    resource_uri: str = Field(..., min_length=1)


McpSelection = Annotated[
    McpSelectionPrompt | McpSelectionResource,
    Field(discriminator="kind"),
]


class JinjaMcpPromptMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant"]
    textPreview: str
    hasBinary: bool = False


class JinjaMcpPromptContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    title: str | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)
    messages: list[JinjaMcpPromptMessage] = Field(default_factory=list)


class JinjaMcpResourceContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uri: str
    name: str | None = None
    mimeType: str | None = None
    text: str | None = None
    hasBinary: bool = False


class JinjaMcpContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    serverName: str
    prompts: list[JinjaMcpPromptContext] = Field(default_factory=list)
    resources: list[JinjaMcpResourceContext] = Field(default_factory=list)


class RunMcpAuditItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selection_id: str
    server_id: UUID
    kind: Literal["prompt", "resource"]
    source_label: str
    summary_label: str
    raw_ref: dict[str, Any] | None = None


class RunMcpResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    system_overlays: list[dict[str, str]] = Field(default_factory=list)
    injected_messages: list[dict[str, Any]] = Field(default_factory=list)
    user_message_parts: list[dict[str, Any]] = Field(default_factory=list)
    template_contexts: list[JinjaMcpContext] = Field(default_factory=list)
    tool_server_ids: list[UUID] = Field(default_factory=list)
    audit: list[RunMcpAuditItem] = Field(default_factory=list)

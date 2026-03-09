from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunModel, RunToolCallModel, Thread, UserSettings
from ..sidecar_client import SidecarClient
from .contracts import ToolOffer, ToolSetName


@dataclass(frozen=True)
class ToolOfferContext:
    db: Session
    thread: Thread
    run: RunModel
    settings: UserSettings
    preset_id: UUID
    user_id: UUID
    project_id: UUID
    input_payload: dict[str, Any]
    vector_storage_enabled: bool
    tool_set_name: ToolSetName
    invocation_mode: str
    allowed_tool_names: set[str] | None = None
    allowed_sub_agent_ids: set[UUID] | None = None


@dataclass(frozen=True)
class ToolValidationContext:
    db: Session
    thread: Thread
    run: RunModel
    user_id: UUID
    project_id: UUID
    language: str
    offer: ToolOffer
    sidecar: SidecarClient | None = None
    preset_id: UUID | None = None
    invocation_mode: str | None = None
    allowed_tool_names: set[str] | None = None
    allowed_sub_agent_ids: set[UUID] | None = None


@dataclass
class ToolExecutionContext:
    db: Session
    thread: Thread
    run: RunModel
    tool_call_row: RunToolCallModel
    user_id: UUID
    project_id: UUID
    language: str
    sidecar: SidecarClient | None = None
    preset_id: UUID | None = None
    invocation_mode: str | None = None
    allowed_tool_names: set[str] | None = None
    allowed_sub_agent_ids: set[UUID] | None = None
    extra: dict[str, Any] = field(default_factory=dict)

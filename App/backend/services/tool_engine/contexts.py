from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunModel, RunToolCallModel, Thread, UserSettings
from .grant_catalog import FeatureKey, ToolCategory


@dataclass(frozen=True)
class ToolAccessPolicy:
    feature_categories: dict[FeatureKey, frozenset[ToolCategory]] | None = None
    allowed_sub_agent_ids: frozenset[UUID] | None = None


@dataclass(frozen=True)
class ToolModuleContext:
    db: Session
    thread: Thread
    run: RunModel
    settings: UserSettings
    preset_id: UUID
    user_id: UUID
    project_id: UUID
    input_payload: dict[str, Any]
    vector_storage_enabled: bool
    invocation_mode: str
    access_policy: ToolAccessPolicy = field(default_factory=ToolAccessPolicy)
    allowed_sub_agent_ids: set[UUID] | None = None


@dataclass(frozen=True)
class ToolValidationContext:
    db: Session
    thread: Thread
    run: RunModel
    settings: UserSettings
    user_id: UUID
    project_id: UUID
    language: str
    preset_id: UUID | None = None
    input_payload: dict[str, Any] = field(default_factory=dict)
    vector_storage_enabled: bool = False
    invocation_mode: str | None = None
    access_policy: ToolAccessPolicy = field(default_factory=ToolAccessPolicy)
    allowed_sub_agent_ids: set[UUID] | None = None


@dataclass
class ToolExecutionContext:
    db: Session
    thread: Thread
    run: RunModel
    settings: UserSettings
    tool_call_row: RunToolCallModel
    user_id: UUID
    project_id: UUID
    language: str
    preset_id: UUID | None = None
    input_payload: dict[str, Any] = field(default_factory=dict)
    vector_storage_enabled: bool = False
    invocation_mode: str | None = None
    access_policy: ToolAccessPolicy = field(default_factory=ToolAccessPolicy)
    allowed_sub_agent_ids: set[UUID] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolGroupExecutionContext:
    db: Session
    thread: Thread
    run: RunModel
    settings: UserSettings
    user_id: UUID
    project_id: UUID
    language: str
    preset_id: UUID | None = None
    input_payload: dict[str, Any] = field(default_factory=dict)
    vector_storage_enabled: bool = False
    invocation_mode: str | None = None
    access_policy: ToolAccessPolicy = field(default_factory=ToolAccessPolicy)
    extra: dict[str, Any] = field(default_factory=dict)

    @staticmethod
    async def await_if_needed(value: Any) -> Any:
        if hasattr(value, "__await__"):
            return await value
        return value

    def to_execution_context(self, tool_call_id: UUID) -> ToolExecutionContext:
        return ToolExecutionContext(
            db=self.db,
            thread=self.thread,
            run=self.run,
            settings=self.settings,
            tool_call_row=RunToolCallModel(id=tool_call_id),
            user_id=self.user_id,
            project_id=self.project_id,
            language=self.language,
            preset_id=self.preset_id,
            input_payload=self.input_payload,
            vector_storage_enabled=self.vector_storage_enabled,
            invocation_mode=self.invocation_mode,
            access_policy=self.access_policy,
            extra=self.extra,
        )

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


ScenarioBlockType = Literal["staticPrompt", "rangeMapping"]
StaticPromptSubtype = Literal["normal", "memory", "prefill"]
StaticRole = Literal["user", "assistant"]


class ScenarioStaticPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subtype: StaticPromptSubtype
    role: StaticRole
    template: str


class ScenarioRangeMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_index: int
    end_index: int
    user_template: str
    assistant_template: str


class ScenarioBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    block_order: int
    enabled: bool
    type: ScenarioBlockType

    staticPrompt: Optional[ScenarioStaticPrompt] = None
    rangeMapping: Optional[ScenarioRangeMapping] = None

    @model_validator(mode="after")
    def _check_shape(self) -> "ScenarioBlock":
        if self.type == "staticPrompt" and self.staticPrompt is None:
            raise ValueError("staticPrompt is required when type=staticPrompt")
        if self.type == "rangeMapping" and self.rangeMapping is None:
            raise ValueError("rangeMapping is required when type=rangeMapping")
        return self


class ScenarioDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    system_template: str
    blocks: list[ScenarioBlock]


class ScenarioContentResponse(BaseModel):
    scenario: ScenarioDocument
    version_number: int
    created_at: datetime
    is_system_default: bool = False


class ScenarioSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: ScenarioDocument
    note: Optional[str] = Field(None, max_length=500)


class ScenarioSaveResponse(BaseModel):
    id: str
    version_number: int
    created_at: datetime
    is_system_default: bool
    warnings: list[str]
    scenario: ScenarioDocument


class ScenarioVersionHistoryItem(BaseModel):
    version_number: int
    created_at: datetime
    note: Optional[str]
    is_system_default: bool
    preview: str


class ScenarioRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_number: int = Field(..., ge=1)


class ScenarioSimulateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_type: str
    task_subtype: str
    scenario: ScenarioDocument
    source_conversation: list[dict[str, Any]]
    template_data: dict[str, Any]


class ScenarioSimulateResponse(BaseModel):
    rendered_system_prompt: str
    rendered_conversation: list[dict[str, Any]]
    prefill: Optional[str] = None
    memory_template: Optional[str] = None


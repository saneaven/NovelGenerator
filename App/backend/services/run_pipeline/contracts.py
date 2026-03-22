from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID


@dataclass
class CreateContext:
    input_text: str
    input_payload: dict[str, Any]


@dataclass(frozen=True)
class StartRunCommand:
    thread_id: UUID
    user_id: UUID
    input_text: str
    input_payload: dict[str, Any] | None
    run_mode: str | None
    surface: str | None
    context_object_ids: list[UUID]
    journey_target_ids: list[UUID]
    language: str | None
    attachments: list[Any] | None = None
    mcp_selections: list[Any] | None = None


@dataclass(frozen=True)
class ResumeRunCommand:
    thread_id: UUID
    user_id: UUID
    run_mode: str | None
    surface: str | None
    context_object_ids: list[UUID]
    journey_target_ids: list[UUID]
    language: str | None

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ToolDeltaState:
    stream_key: str
    llm_call_id: str
    name: str
    raw_arguments: str
    index: int | None


@dataclass
class AssistantMessageExecutionState:
    message_id: Any | None = None
    finalized: bool = False


@dataclass
class CreateContext:
    input_text: str
    input_payload: dict[str, Any]

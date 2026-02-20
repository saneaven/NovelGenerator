from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ToolDeltaState:
    llm_call_id: str
    name: str
    raw_arguments: str


@dataclass
class CreateContext:
    input_text: str
    input_payload: dict[str, Any]

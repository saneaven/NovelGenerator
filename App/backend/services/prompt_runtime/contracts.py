from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ScenarioBundle:
    task_type: str
    task_subtype: str
    template_data: dict[str, Any]
    system_prompt: str
    memory_template: str | None


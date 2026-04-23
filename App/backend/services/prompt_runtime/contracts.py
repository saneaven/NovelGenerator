from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .template_renderer import TemplateRenderer


@dataclass(frozen=True)
class ScenarioBundle:
    task_type: str
    task_subtype: str
    template_data: dict[str, Any]
    blocks: list[dict[str, Any]]
    system_template: str
    project_data: dict[str, Any]
    template_renderer_factory: Callable[[], TemplateRenderer]

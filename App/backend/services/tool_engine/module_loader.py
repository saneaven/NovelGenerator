from __future__ import annotations

from .registry import ToolRegistry
from .modules import manuscript_module, outline_module, project_meta_module, search_module, story_object_module, sub_agent_module


def build_registry() -> ToolRegistry:
    registry = ToolRegistry()
    story_object_module.register(registry)
    project_meta_module.register(registry)
    outline_module.register(registry)
    manuscript_module.register(registry)
    search_module.register(registry)
    sub_agent_module.register(registry)
    return registry

from __future__ import annotations

from functools import lru_cache

from .registry import ToolRegistry, registered_feature_module_factories
from .modules import image_module, manuscript_module, mcp_feature_module, outline_module, project_data_module, project_tree_module, search_feature_module, story_entity_module, sub_agent_module, timeline_module


def build_registry() -> ToolRegistry:
    _ = (
        project_data_module,
        story_entity_module,
        outline_module,
        manuscript_module,
        timeline_module,
        search_feature_module,
        project_tree_module,
        image_module,
        sub_agent_module,
        mcp_feature_module,
    )
    registry = ToolRegistry()
    for factory in registered_feature_module_factories():
        registry.register_module(factory())
    return registry


@lru_cache(maxsize=1)
def list_registered_auto_approve_categories() -> tuple[str, ...]:
    return ("read", "write", "delete", "translate", "sub_agent", "generate", "mcp")

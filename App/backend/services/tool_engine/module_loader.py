from __future__ import annotations

from functools import lru_cache

from .registry import ToolRegistry, registered_module_factories
from .modules import call_module, create_module, delete_module, generate_module, mcp_module, patch_module, patch_translation_module, read_module, replace_module, search_module, translate_module, tree_module


def build_registry() -> ToolRegistry:
    _ = (
        call_module,
        create_module,
        delete_module,
        generate_module,
        mcp_module,
        patch_module,
        patch_translation_module,
        read_module,
        replace_module,
        search_module,
        translate_module,
        tree_module,
    )
    registry = ToolRegistry()
    for factory in registered_module_factories():
        registry.register_module(factory())
    return registry


@lru_cache(maxsize=1)
def list_registered_auto_approve_categories() -> tuple[str, ...]:
    return tuple(build_registry().list_auto_approve_categories())

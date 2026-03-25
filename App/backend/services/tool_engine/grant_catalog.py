from __future__ import annotations

from typing import Final, Literal


ToolCategory = Literal[
    "read",
    "write",
    "delete",
    "translate",
    "sub_agent",
    "generate",
    "mcp",
]

FeatureKey = Literal[
    "project_data",
    "story_entity",
    "outline",
    "manuscript",
    "timeline",
    "search",
    "project_tree",
    "image",
    "sub_agent",
    "mcp",
]


TOOL_GRANT_CATALOG: Final[dict[str, dict[str, object]]] = {
    "project_data": {
        "display_name": "Project Data",
        "supported_categories": ("write", "translate"),
    },
    "story_entity": {
        "display_name": "Story Entities",
        "supported_categories": ("read", "write", "delete", "translate"),
    },
    "outline": {
        "display_name": "Outline",
        "supported_categories": ("read", "write", "delete", "translate"),
    },
    "manuscript": {
        "display_name": "Manuscript",
        "supported_categories": ("read", "write", "translate"),
    },
    "timeline": {
        "display_name": "Timeline",
        "supported_categories": ("read", "write", "delete", "translate"),
    },
    "search": {
        "display_name": "Search",
        "supported_categories": ("read",),
    },
    "project_tree": {
        "display_name": "Project Tree",
        "supported_categories": ("read",),
    },
    "image": {
        "display_name": "Image Generation",
        "supported_categories": ("generate",),
    },
    "sub_agent": {
        "display_name": "Sub Agents",
        "supported_categories": ("sub_agent",),
    },
    "mcp": {
        "display_name": "MCP",
        "supported_categories": ("mcp",),
    },
}


def ordered_feature_keys() -> tuple[str, ...]:
    return tuple(TOOL_GRANT_CATALOG.keys())


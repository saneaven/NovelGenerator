from __future__ import annotations

from typing import Any

from ..contexts import ToolModuleContext
from ..contracts import ToolSpec


def obj_schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required,
    }


def allow_tool(ctx: ToolModuleContext, tool_name: str) -> bool:
    return ctx.allowed_tool_names is None or tool_name in ctx.allowed_tool_names


def filter_allowed_specs(ctx: ToolModuleContext, specs: list[ToolSpec]) -> list[ToolSpec]:
    return [spec for spec in specs if allow_tool(ctx, spec.name)]


def is_non_journey(ctx: ToolModuleContext) -> bool:
    return ctx.thread.thread_type != "journey"


def journey_kind(ctx: ToolModuleContext) -> str:
    return str(ctx.thread.journey_kind or "").strip()


def is_story_object_journey(ctx: ToolModuleContext) -> bool:
    return ctx.thread.thread_type == "journey" and journey_kind(ctx) == "storyObjectEdit"


def is_outline_journey(ctx: ToolModuleContext) -> bool:
    return ctx.thread.thread_type == "journey" and journey_kind(ctx) == "outlineEdit"


def is_manuscript_journey(ctx: ToolModuleContext) -> bool:
    return ctx.thread.thread_type == "journey" and journey_kind(ctx) == "manuscriptEdit"


def is_translation_journey(ctx: ToolModuleContext) -> bool:
    return ctx.thread.thread_type == "journey" and journey_kind(ctx) == "objectTranslation"


def is_plan_mode(ctx: ToolModuleContext) -> bool:
    return ctx.invocation_mode == "planMode"


def is_agent_write_context(ctx: ToolModuleContext) -> bool:
    return is_non_journey(ctx) and not is_plan_mode(ctx)

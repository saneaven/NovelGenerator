from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.object_service import object_service
from .object_access import read_object, require_story_object_type, to_uuid
from .shared import filter_allowed_specs, is_agent_write_context, is_outline_journey, is_story_object_journey, obj_schema


_ID = {"type": "string", "description": "Object ID"}
_STORY_TYPE = {"type": "string", "enum": ["character", "location", "organization", "lorebook"]}


@tool_call_module(prefix="delete_")
class DeleteToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("delete",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not (is_agent_write_context(ctx) or is_story_object_journey(ctx) or is_outline_journey(ctx)):
            return []

        specs: list[ToolSpec] = []
        if is_agent_write_context(ctx) or is_story_object_journey(ctx):
            specs.append(
                ToolSpec(
                    name="delete_story_object",
                    description="Delete a story object.",
                    parameters=obj_schema({"id": _ID, "type": _STORY_TYPE}, ["id", "type"]),
                    auto_approve_category="delete",
                )
            )
        if is_agent_write_context(ctx) or is_outline_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="delete_outline",
                        description="Delete an outline.",
                        parameters=obj_schema({"id": _ID}, ["id"]),
                        auto_approve_category="delete",
                    ),
                    ToolSpec(
                        name="delete_outline_act",
                        description="Delete an act.",
                        parameters=obj_schema({"id": _ID}, ["id"]),
                        auto_approve_category="delete",
                    ),
                    ToolSpec(
                        name="delete_outline_chapter",
                        description="Delete a chapter.",
                        parameters=obj_schema({"id": _ID}, ["id"]),
                        auto_approve_category="delete",
                    ),
                ]
            )
        return filter_allowed_specs(ctx, specs)

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            object_id = to_uuid(args.get("id"), "id")
            if tool_name == "delete_story_object":
                object_type = require_story_object_type(args.get("type"))
            elif tool_name == "delete_outline":
                object_type = "outline"
            elif tool_name == "delete_outline_act":
                object_type = "act"
            elif tool_name == "delete_outline_chapter":
                object_type = "chapter"
            else:
                return invalid_result("validate_delete_tool_name", f"Unsupported delete tool: {tool_name}")

            read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result(f"validate_{tool_name}", str(exc))

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        object_id = to_uuid(args.get("id"), "id")
        if tool_name == "delete_story_object":
            object_type = require_story_object_type(args.get("type"))
        elif tool_name == "delete_outline":
            object_type = "outline"
        elif tool_name == "delete_outline_act":
            object_type = "act"
        elif tool_name == "delete_outline_chapter":
            object_type = "chapter"
        else:
            raise ValueError(f"Unsupported delete tool: {tool_name}")

        object_service.delete_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type=object_type,
            object_id=object_id,
            user_id=ctx.user_id,
        )
        return make_result(f"Deleted {object_type}", object_id=str(object_id), object_type=object_type)

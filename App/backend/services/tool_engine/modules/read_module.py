from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from .manuscript_access import ensure_manuscript_exists, read_manuscript_markdown
from .object_access import (
    STORY_OBJECT_TYPES,
    extract_lang_data,
    read_object,
    require_story_object_type,
    to_uuid,
)
from .shared import filter_allowed_specs, is_non_journey, obj_schema


_ID = {"type": "string", "description": "Object ID"}
_OFFSET = {
    "type": "object",
    "properties": {"from": {"type": "integer"}, "to": {"type": "integer"}},
    "required": ["from", "to"],
}


@tool_call_module(prefix="read_")
class ReadToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("read",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not is_non_journey(ctx):
            return []
        return filter_allowed_specs(
            ctx,
            [
                ToolSpec(
                    name="read_story_object",
                    description="Read a story object.",
                    parameters=obj_schema(
                        {"id": _ID, "type": {"type": "string", "enum": list(STORY_OBJECT_TYPES)}},
                        ["id", "type"],
                    ),
                    auto_approve_category="read",
                ),
                ToolSpec(
                    name="read_basic_info",
                    description="Read project basic info.",
                    parameters=obj_schema({"id": _ID}, ["id"]),
                    auto_approve_category="read",
                ),
                ToolSpec(
                    name="read_guidelines",
                    description="Read project guidelines.",
                    parameters=obj_schema({"id": _ID}, ["id"]),
                    auto_approve_category="read",
                ),
                ToolSpec(
                    name="read_outline",
                    description="Read an outline.",
                    parameters=obj_schema({"id": _ID}, ["id"]),
                    auto_approve_category="read",
                ),
                ToolSpec(
                    name="read_outline_act",
                    description="Read an outline act.",
                    parameters=obj_schema({"id": _ID}, ["id"]),
                    auto_approve_category="read",
                ),
                ToolSpec(
                    name="read_outline_chapter",
                    description="Read an outline chapter.",
                    parameters=obj_schema({"id": _ID}, ["id"]),
                    auto_approve_category="read",
                ),
                ToolSpec(
                    name="read_manuscript",
                    description="Read manuscript text.",
                    parameters=obj_schema({"id": _ID, "offset": _OFFSET}, ["id"]),
                    auto_approve_category="read",
                ),
            ],
        )

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            object_id = to_uuid(args.get("id"), "id")
            if tool_name == "read_story_object":
                object_type = require_story_object_type(args.get("type"))
            elif tool_name == "read_basic_info":
                object_type = "basic_info"
            elif tool_name == "read_guidelines":
                object_type = "guidelines"
            elif tool_name == "read_outline":
                object_type = "outline"
            elif tool_name == "read_outline_act":
                object_type = "act"
            elif tool_name == "read_outline_chapter":
                object_type = "chapter"
            elif tool_name == "read_manuscript":
                ensure_manuscript_exists(
                    db=ctx.db,
                    project_id=ctx.project_id,
                    object_id=object_id,
                    language=ctx.language,
                )
                return valid_result()
            else:
                return invalid_result("validate_read_tool_name", f"Unsupported read tool: {tool_name}")

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

        if tool_name == "read_story_object":
            object_type = require_story_object_type(args.get("type"))
        elif tool_name == "read_basic_info":
            object_type = "basic_info"
        elif tool_name == "read_guidelines":
            object_type = "guidelines"
        elif tool_name == "read_outline":
            object_type = "outline"
        elif tool_name == "read_outline_act":
            object_type = "act"
        elif tool_name == "read_outline_chapter":
            object_type = "chapter"
        elif tool_name == "read_manuscript":
            _, content = await read_manuscript_markdown(
                db=ctx.db,
                project_id=ctx.project_id,
                object_id=object_id,
                language=ctx.language,
                sidecar=ctx.sidecar,
            )
            return make_result(
                "Read successful",
                object_id=str(object_id),
                object_type="manuscript",
                data={"object": {"content": content}},
            )
        else:
            raise ValueError(f"Unsupported read tool: {tool_name}")

        obj = read_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type=object_type,
            object_id=object_id,
            language=ctx.language,
        )
        return make_result(
            "Read successful",
            object_id=str(object_id),
            object_type=object_type,
            data={"object": extract_lang_data(obj, ctx.language)},
        )

from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.object_service import object_service
from ....utils.story_entities import STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE
from .object_access import read_object, read_story_entity, read_story_entity_folder, to_uuid
from .shared import filter_allowed_specs, is_agent_write_context, is_outline_journey, is_object_journey, obj_schema


_ID = {"type": "string", "description": "Object ID"}
_ENTITY_KIND = {"type": "string", "enum": ["character", "location", "organization", "lorebook"]}


@tool_call_module(prefix="delete_")
class DeleteToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("delete",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not (is_agent_write_context(ctx) or is_object_journey(ctx) or is_outline_journey(ctx)):
            return []

        specs: list[ToolSpec] = []
        if is_agent_write_context(ctx) or is_object_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="delete_story_entity",
                        description="Delete a story entity.",
                        parameters=obj_schema({"id": _ID, "kind": _ENTITY_KIND}, ["id", "kind"]),
                        auto_approve_category="delete",
                    ),
                    ToolSpec(
                        name="delete_story_entity_folder",
                        description="Delete a story entity folder.",
                        parameters=obj_schema({"id": _ID}, ["id"]),
                        auto_approve_category="delete",
                    ),
                ]
            )
        if is_agent_write_context(ctx) or is_outline_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="delete_outline",
                        description="Delete an outline item.",
                        parameters=obj_schema({"id": _ID}, ["id"]),
                        auto_approve_category="delete",
                    ),
                ]
            )
        return filter_allowed_specs(ctx, specs)

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            object_id = to_uuid(args.get("id"), "id")
            if tool_name == "delete_story_entity":
                read_story_entity(
                    ctx.db,
                    project_id=ctx.project_id,
                    object_id=object_id,
                    language=ctx.language,
                    kind=args.get("kind"),
                )
                return valid_result()
            elif tool_name == "delete_story_entity_folder":
                read_story_entity_folder(
                    ctx.db,
                    project_id=ctx.project_id,
                    object_id=object_id,
                    language=ctx.language,
                )
                return valid_result()
            elif tool_name == "delete_outline":
                object_type = "outline"
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
        if tool_name == "delete_story_entity":
            object_type = STORY_ENTITY_TYPE
        elif tool_name == "delete_story_entity_folder":
            object_type = STORY_ENTITY_FOLDER_TYPE
        elif tool_name == "delete_outline":
            object_type = "outline"
        else:
            raise ValueError(f"Unsupported delete tool: {tool_name}")

        object_service.delete_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type=object_type,
            object_id=object_id,
            user_id=ctx.user_id,
        )
        if tool_name == "delete_story_entity":
            return make_result(
                f"Deleted {args.get('kind')}",
                object_id=str(object_id),
                object_type=object_type,
                data={"kind": args.get("kind")},
            )
        if tool_name == "delete_story_entity_folder":
            return make_result("Deleted story entity folder", object_id=str(object_id), object_type=object_type)
        return make_result("Deleted outline", object_id=str(object_id), object_type=object_type)

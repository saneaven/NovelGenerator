from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.object_service import object_service
from ....utils.story_entities import STORY_ENTITY_TYPE
from .object_access import require_story_entity_arg_kind, to_uuid, ensure_outline_parent_exists, ensure_act_parent_exists
from .shared import filter_allowed_specs, is_agent_write_context, is_outline_journey, is_object_journey, obj_schema


_NAME = {"type": "string", "description": "Name"}
_DESC = {"type": "string", "description": "Description"}
_CONTENT = {"type": "string", "description": "Content"}
_ENTITY_KIND = {"type": "string", "enum": ["character", "location", "organization", "lorebook"]}


@tool_call_module(prefix="create_")
class CreateToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("create",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not (is_agent_write_context(ctx) or is_object_journey(ctx) or is_outline_journey(ctx)):
            return []

        specs: list[ToolSpec] = []
        if is_agent_write_context(ctx) or is_object_journey(ctx):
            specs.append(
                ToolSpec(
                    name="create_story_entity",
                    description="Create a story entity.",
                    parameters=obj_schema(
                        {"kind": _ENTITY_KIND, "name": _NAME, "description": _DESC, "content": _CONTENT},
                        ["kind", "name", "content"],
                    ),
                    auto_approve_category="create",
                )
            )
        if is_agent_write_context(ctx) or is_outline_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="create_outline",
                        description="Create an outline.",
                        parameters=obj_schema({"name": _NAME, "description": _DESC, "content": _CONTENT}, ["name", "content"]),
                        auto_approve_category="create",
                    ),
                    ToolSpec(
                        name="create_outline_act",
                        description="Create an act in outline.",
                        parameters=obj_schema(
                            {"outlineId": {"type": "string"}, "name": _NAME, "description": _DESC, "content": _CONTENT},
                            ["outlineId", "name", "content"],
                        ),
                        auto_approve_category="create",
                    ),
                    ToolSpec(
                        name="create_outline_chapter",
                        description="Create a chapter in act.",
                        parameters=obj_schema(
                            {"actId": {"type": "string"}, "name": _NAME, "description": _DESC, "content": _CONTENT},
                            ["actId", "name", "content"],
                        ),
                        auto_approve_category="create",
                    ),
                ]
            )
        return filter_allowed_specs(ctx, specs)

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            if tool_name == "create_story_entity":
                require_story_entity_arg_kind(args.get("kind"))
            elif tool_name == "create_outline_act":
                ensure_outline_parent_exists(
                    ctx.db,
                    project_id=ctx.project_id,
                    outline_id=to_uuid(args.get("outlineId"), "outlineId"),
                )
            elif tool_name == "create_outline_chapter":
                ensure_act_parent_exists(
                    ctx.db,
                    project_id=ctx.project_id,
                    act_id=to_uuid(args.get("actId"), "actId"),
                )
            return valid_result()
        except ValueError as exc:
            return invalid_result(f"validate_{tool_name}", str(exc))

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        payload = {
            "name": str(args.get("name") or ""),
            "description": str(args.get("description") or ""),
            "content": str(args.get("content") or ""),
        }

        if tool_name == "create_story_entity":
            kind = require_story_entity_arg_kind(args.get("kind"))
            created = object_service.create_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=STORY_ENTITY_TYPE,
                data=payload,
                language=ctx.language,
                kind=kind,
                user_request="tool:create_story_entity",
                created_by=ctx.user_id,
            )
            return make_result(
                f"Created {kind}",
                object_id=created["id"],
                object_type=STORY_ENTITY_TYPE,
                data={"kind": kind},
            )

        if tool_name == "create_outline":
            created = object_service.create_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="outline",
                data=payload,
                language=ctx.language,
                user_request="tool:create_outline",
                created_by=ctx.user_id,
            )
            return make_result("Created outline", object_id=created["id"], object_type="outline")

        if tool_name == "create_outline_act":
            created = object_service.create_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="act",
                data=payload,
                language=ctx.language,
                metadata={"outline_id": str(args.get("outlineId") or "")},
                user_request="tool:create_outline_act",
                created_by=ctx.user_id,
            )
            return make_result("Created act", object_id=created["id"], object_type="act")

        if tool_name == "create_outline_chapter":
            created = object_service.create_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="chapter",
                data=payload,
                language=ctx.language,
                metadata={"act_id": str(args.get("actId") or "")},
                user_request="tool:create_outline_chapter",
                created_by=ctx.user_id,
            )
            return make_result(
                "Created chapter",
                object_id=created["id"],
                object_type="chapter",
                data={"manuscriptId": created.get("metadata", {}).get("manuscript_id")},
            )

        raise ValueError(f"Unsupported create tool: {tool_name}")

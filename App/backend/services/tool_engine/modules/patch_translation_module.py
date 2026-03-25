from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.object_service import object_service
from ....services.timeline_service import _UNSET, timeline_service
from ....utils.story_entities import STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE
from .manuscript_access import ensure_manuscript_exists, patch_manuscript, validate_patch_args as validate_manuscript_patch
from .object_access import (
    extract_lang_data,
    get_primary_object_id,
    patch_object_field,
    read_object,
    read_story_entity_folder,
    read_story_entity,
    to_uuid,
)
from .shared import filter_allowed_specs, is_translation_journey, obj_schema


_ID = {"type": "string", "description": "Object ID"}
_TEXT_PATCH = {"old": {"type": "string"}, "new": {"type": "string"}}


@tool_call_module(prefix="patch_translation_")
class PatchTranslationToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("patch_translation",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not is_translation_journey(ctx):
            return []
        return filter_allowed_specs(
            ctx,
            [
                ToolSpec(
                    name="patch_translation_story_entity",
                    description="Patch story entity translation by single replacement.",
                    parameters=obj_schema({"id": _ID, "kind": {"type": "string", "enum": ["character", "location", "organization", "lorebook"]}, "field": {"type": "string", "enum": ["name", "description", "content"]}, **_TEXT_PATCH}, ["id", "kind", "field", "old", "new"]),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="patch_translation_story_entity_folder",
                    description="Patch story entity folder translation by single replacement.",
                    parameters=obj_schema(
                        {"id": _ID, "field": {"type": "string", "enum": ["name", "description"]}, **_TEXT_PATCH},
                        ["id", "field", "old", "new"],
                    ),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="patch_translation_basic_info",
                    description="Patch basic info translation by single replacement.",
                    parameters=obj_schema({"field": {"type": "string", "enum": ["title", "logline"]}, **_TEXT_PATCH}, ["field", "old", "new"]),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="patch_translation_guidelines",
                    description="Patch guidelines translation by single replacement.",
                    parameters=obj_schema({"field": {"type": "string", "enum": ["authorNote"]}, **_TEXT_PATCH}, ["field", "old", "new"]),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="patch_translation_outline",
                    description="Patch outline item translation by single replacement.",
                    parameters=obj_schema({"id": _ID, "field": {"type": "string", "enum": ["name", "description", "content"]}, **_TEXT_PATCH}, ["id", "field", "old", "new"]),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="patch_translation_manuscript",
                    description="Patch manuscript translation by single replacement.",
                    parameters=obj_schema({"id": _ID, **_TEXT_PATCH}, ["id", "old", "new"]),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="patch_translation_timeline_track",
                    description="Patch a timeline track translation by single replacement.",
                    parameters=obj_schema(
                        {"id": _ID, "field": {"type": "string", "enum": ["name", "description"]}, **_TEXT_PATCH},
                        ["id", "field", "old", "new"],
                    ),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="patch_translation_timeline_event",
                    description="Patch a timeline event translation by single replacement.",
                    parameters=obj_schema(
                        {"id": _ID, "field": {"type": "string", "enum": ["name", "description"]}, **_TEXT_PATCH},
                        ["id", "field", "old", "new"],
                    ),
                    auto_approve_category="patch_translation",
                ),
            ],
        )

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            if tool_name == "patch_translation_basic_info":
                field = args.get("field")
                if field not in {"title", "logline"}:
                    raise ValueError("field must be one of title|logline")
                object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
                current = read_object(ctx.db, project_id=ctx.project_id, object_type="basic_info", object_id=object_id, language=ctx.language)
                patch_object_field(extract_lang_data(current, ctx.language), field=str(field), old=str(args.get("old") or ""), new=str(args.get("new") or ""))
                return valid_result()

            if tool_name == "patch_translation_guidelines":
                if args.get("field") != "authorNote":
                    raise ValueError("field must be authorNote")
                object_id = get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
                current = read_object(ctx.db, project_id=ctx.project_id, object_type="guidelines", object_id=object_id, language=ctx.language)
                patch_object_field(extract_lang_data(current, ctx.language), field="authorNote", old=str(args.get("old") or ""), new=str(args.get("new") or ""))
                return valid_result()

            object_id = to_uuid(args.get("id"), "id")
            if tool_name == "patch_translation_story_entity":
                field = args.get("field")
                if field not in {"name", "description", "content"}:
                    raise ValueError("field must be one of name|description|content")
                current = read_story_entity(
                    ctx.db,
                    project_id=ctx.project_id,
                    object_id=object_id,
                    language=ctx.language,
                    kind=args.get("kind"),
                )
                patch_object_field(extract_lang_data(current, ctx.language), field=str(field), old=str(args.get("old") or ""), new=str(args.get("new") or ""))
                return valid_result()
            elif tool_name == "patch_translation_story_entity_folder":
                field = args.get("field")
                if field not in {"name", "description"}:
                    raise ValueError("field must be one of name|description")
                current = read_story_entity_folder(
                    ctx.db,
                    project_id=ctx.project_id,
                    object_id=object_id,
                    language=ctx.language,
                )
                patch_object_field(extract_lang_data(current, ctx.language), field=str(field), old=str(args.get("old") or ""), new=str(args.get("new") or ""))
                return valid_result()
            elif tool_name == "patch_translation_outline":
                field = args.get("field")
                if field not in {"name", "description", "content"}:
                    raise ValueError("field must be one of name|description|content")
                object_type = "outline"
            elif tool_name == "patch_translation_timeline_track":
                field = args.get("field")
                if field not in {"name", "description"}:
                    raise ValueError("field must be one of name|description")
                object_type = "timeline_track"
            elif tool_name == "patch_translation_timeline_event":
                field = args.get("field")
                if field not in {"name", "description"}:
                    raise ValueError("field must be one of name|description")
                object_type = "timeline_event"
            elif tool_name == "patch_translation_manuscript":
                ensure_manuscript_exists(db=ctx.db, project_id=ctx.project_id, object_id=object_id, language=ctx.language)
                await validate_manuscript_patch(args=args, ctx=ctx, object_id=object_id)
                return valid_result()
            else:
                return invalid_result("validate_patch_translation_tool_name", f"Unsupported patch translation tool: {tool_name}")

            current = read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
            patch_object_field(extract_lang_data(current, ctx.language), field=str(field), old=str(args.get("old") or ""), new=str(args.get("new") or ""))
            return valid_result()
        except ValueError as exc:
            return invalid_result(f"validate_{tool_name}", str(exc))

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        if tool_name == "patch_translation_basic_info":
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
            current = read_object(ctx.db, project_id=ctx.project_id, object_type="basic_info", object_id=object_id, language=ctx.language)
            next_data = patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(args.get("field") or ""),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            object_service.update_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="basic_info",
                object_id=object_id,
                data=next_data,
                language=ctx.language,
                user_request="tool:patch_translation_basic_info",
                created_by=ctx.user_id,
                create_new_version=False,
            )
            return make_result("Patched translation basic_info", object_id=str(object_id), object_type="basic_info")

        if tool_name == "patch_translation_guidelines":
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
            current = read_object(ctx.db, project_id=ctx.project_id, object_type="guidelines", object_id=object_id, language=ctx.language)
            next_data = patch_object_field(
                extract_lang_data(current, ctx.language),
                field="authorNote",
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            object_service.update_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="guidelines",
                object_id=object_id,
                data=next_data,
                language=ctx.language,
                user_request="tool:patch_translation_guidelines",
                created_by=ctx.user_id,
                create_new_version=False,
            )
            return make_result("Patched translation guidelines", object_id=str(object_id), object_type="guidelines")

        object_id = to_uuid(args.get("id"), "id")

        if tool_name == "patch_translation_story_entity":
            object_type = STORY_ENTITY_TYPE
            current = read_story_entity(
                ctx.db,
                project_id=ctx.project_id,
                object_id=object_id,
                language=ctx.language,
                kind=args.get("kind"),
            )
        elif tool_name == "patch_translation_story_entity_folder":
            object_type = STORY_ENTITY_FOLDER_TYPE
            current = read_story_entity_folder(
                ctx.db,
                project_id=ctx.project_id,
                object_id=object_id,
                language=ctx.language,
            )
        elif tool_name == "patch_translation_outline":
            object_type = "outline"
        elif tool_name == "patch_translation_timeline_track":
            current = read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_track",
                object_id=object_id,
                language=ctx.language,
            )
            next_data = patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(args.get("field") or ""),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            result = timeline_service.update_track(
                ctx.db,
                project_id=ctx.project_id,
                track_id=object_id,
                language=ctx.language,
                name=str(next_data.get("name") or ""),
                description=str(next_data.get("description") or ""),
                color=_UNSET,
                user_request="tool:patch_translation_timeline_track",
                create_new_version=False,
                user_id=ctx.user_id,
            )
            return make_result("Patched timeline track translation", object_id=result["id"], object_type="timeline_track")
        elif tool_name == "patch_translation_timeline_event":
            current = read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_event",
                object_id=object_id,
                language=ctx.language,
            )
            next_data = patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(args.get("field") or ""),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            result = timeline_service.update_event(
                ctx.db,
                project_id=ctx.project_id,
                event_id=object_id,
                track_id=None,
                language=ctx.language,
                name=str(next_data.get("name") or ""),
                description=str(next_data.get("description") or ""),
                start_date=_UNSET,
                end_date=_UNSET,
                tags=_UNSET,
                user_request="tool:patch_translation_timeline_event",
                create_new_version=False,
                user_id=ctx.user_id,
            )
            return make_result("Patched timeline event translation", object_id=result["id"], object_type="timeline_event")
        elif tool_name == "patch_translation_manuscript":
            await patch_manuscript(
                args=args,
                ctx=ctx,
                object_id=object_id,
                user_request="tool:patch_translation_manuscript",
                create_new_version=False,
            )
            return make_result("Patched translation manuscript", object_id=str(object_id), object_type="manuscript")
        else:
            raise ValueError(f"Unsupported patch translation tool: {tool_name}")

        field = str(args.get("field") or "")
        if tool_name != "patch_translation_story_entity":
            current = read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
        next_data = patch_object_field(
            extract_lang_data(current, ctx.language),
            field=field,
            old=str(args.get("old") or ""),
            new=str(args.get("new") or ""),
        )
        object_service.update_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type=object_type,
            object_id=object_id,
            data=next_data,
            language=ctx.language,
            kind=(str(args.get("kind") or "") if tool_name == "patch_translation_story_entity" else None),
            user_request=f"tool:{tool_name}",
            created_by=ctx.user_id,
            create_new_version=False,
        )
        if tool_name == "patch_translation_story_entity":
            return make_result(
                f"Patched translation {args.get('kind')}",
                object_id=str(object_id),
                object_type=object_type,
                data={"kind": args.get("kind")},
            )
        if tool_name == "patch_translation_story_entity_folder":
            return make_result(
                "Patched translation story entity folder",
                object_id=str(object_id),
                object_type=object_type,
            )
        return make_result(
            "Patched translation outline",
            object_id=str(object_id),
            object_type=object_type,
            data={"kind": current.get("kind")},
        )

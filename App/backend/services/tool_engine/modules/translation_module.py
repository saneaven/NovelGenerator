from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext
from ..contracts import ToolSpec
from ..registry import ToolRegistry
from ..result_utils import make_result
from .common_object_helpers import (
    extract_lang_data,
    get_primary_object_id,
    obj_schema,
    patch_object_data,
    read_object,
    to_uuid,
)
from ....services.manuscript_image_index_service import restore_image_asset_ids
from ....services.object_service import object_service
from ....services.sidecar_client import SidecarConversionError, SidecarUnavailableError

# Re-use validators from existing modules (validation logic is identical).
from .story_object_module import _validate_story_object_exists, _validate_patch_story_object
from .manuscript_module import _validate_manuscript_exists, _validate_patch_manuscript
from .outline_module import (
    _make_exists_validator,
    _make_patch_validator,
)
from .project_meta_module import (
    _validate_basic_info_exists,
    _validate_guidelines_exists,
    _validate_patch_basic_info,
    _validate_patch_guidelines,
)

_TRANSLATION_TOOL_SET = frozenset({"objectTranslation"})

_ID = {"type": "string", "description": "Object ID"}
_NAME = {"type": "string", "description": "Name"}
_DESC = {"type": "string", "description": "Description"}
_CONTENT = {"type": "string", "description": "Content"}
_STORY_TYPE = {
    "type": "string",
    "enum": ["character", "location", "organization", "lorebook"],
    "description": "Story object type",
}


# ---------------------------------------------------------------------------
# Story object executors
# ---------------------------------------------------------------------------

async def _execute_translate_story_object(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type = str(args.get("type") or "")
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = dict(lang_data)
    for key in ["name", "description", "content"]:
        if key in args:
            next_data[key] = args[key]

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:translate_story_object",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result(f"Translated {object_type}", object_id=str(object_id), object_type=object_type)


async def _execute_translate_patch_story_object(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type = str(args.get("type") or "")
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = patch_object_data(lang_data, args)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:translate_patch_story_object",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result(f"Patched translation {object_type}", object_id=str(object_id), object_type=object_type)


# ---------------------------------------------------------------------------
# Basic info executors
# ---------------------------------------------------------------------------

async def _execute_translate_basic_info(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
    current = read_object(ctx.db, ctx.project_id, "basic_info", object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = dict(lang_data)
    for key in ["title", "logline", "genre"]:
        if key in args:
            next_data[key] = args[key]

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="basic_info",
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:translate_basic_info",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result("Translated basic_info", object_id=str(object_id), object_type="basic_info")


async def _execute_translate_patch_basic_info(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
    current = read_object(ctx.db, ctx.project_id, "basic_info", object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = patch_object_data(lang_data, args)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="basic_info",
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:translate_patch_basic_info",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result("Patched translation basic_info", object_id=str(object_id), object_type="basic_info")


# ---------------------------------------------------------------------------
# Guidelines executors
# ---------------------------------------------------------------------------

async def _execute_translate_guidelines(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, "guidelines", object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = dict(lang_data)
    if "authorNote" in args:
        next_data["authorNote"] = args.get("authorNote")

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="guidelines",
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:translate_guidelines",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result("Translated guidelines", object_id=str(object_id), object_type="guidelines")


async def _execute_translate_patch_guidelines(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, "guidelines", object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = patch_object_data(lang_data, args)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="guidelines",
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:translate_patch_guidelines",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result("Patched translation guidelines", object_id=str(object_id), object_type="guidelines")


# ---------------------------------------------------------------------------
# Outline executors
# ---------------------------------------------------------------------------

_OUTLINE_TYPE_MAP = {
    "translate_outline": "outline",
    "translate_patch_outline": "outline",
    "translate_outline_act": "act",
    "translate_patch_outline_act": "act",
    "translate_outline_chapter": "chapter",
    "translate_patch_outline_chapter": "chapter",
}


def _prepare_outline(
    tool_name: str,
    args: dict[str, Any],
    ctx: ToolExecutionContext,
) -> tuple[str, Any, dict[str, Any]]:
    object_type = _OUTLINE_TYPE_MAP[tool_name]
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)
    return object_type, object_id, lang_data


async def _execute_translate_outline(tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type, object_id, lang_data = _prepare_outline(tool_name, args, ctx)

    next_data = dict(lang_data)
    for key in ["name", "description", "content"]:
        if key in args:
            next_data[key] = args[key]

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request=f"tool:{tool_name}",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result(f"Translated {object_type}", object_id=str(object_id), object_type=object_type)


async def _execute_translate_patch_outline(tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type, object_id, lang_data = _prepare_outline(tool_name, args, ctx)

    next_data = patch_object_data(lang_data, args)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request=f"tool:{tool_name}",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result(f"Patched translation {object_type}", object_id=str(object_id), object_type=object_type)


# ---------------------------------------------------------------------------
# Manuscript executors
# ---------------------------------------------------------------------------

async def _execute_translate_manuscript(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    content = str(args.get("content") or "")

    if ctx.sidecar is None:
        raise ValueError("SIDECAR_ERROR: sidecar client unavailable")

    obj = read_object(ctx.db, ctx.project_id, "manuscript", object_id, ctx.language)
    lang_data = extract_lang_data(obj, ctx.language)
    original_doc = lang_data.get("doc")

    doc = await ctx.sidecar.markdown_to_doc(content)
    if isinstance(original_doc, dict):
        restore_image_asset_ids(doc, original_doc)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="manuscript",
        object_id=object_id,
        data={"doc": doc, "wordCount": len(content.split())},
        language=ctx.language,
        user_request="tool:translate_manuscript",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result("Translated manuscript", object_id=str(object_id), object_type="manuscript")


async def _execute_translate_patch_manuscript(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    if ctx.sidecar is None:
        raise ValueError("SIDECAR_ERROR: sidecar client unavailable")

    object_id = to_uuid(args.get("id"), "id")
    old_text = str(args.get("old") or "")
    new_text = str(args.get("new") or "")

    obj = read_object(ctx.db, ctx.project_id, "manuscript", object_id, ctx.language)
    lang_data = extract_lang_data(obj, ctx.language)
    doc = lang_data.get("doc")
    if not isinstance(doc, dict):
        raise ValueError("MANUSCRIPT_EMPTY")

    try:
        markdown = await ctx.sidecar.doc_to_markdown(doc)
    except SidecarUnavailableError as exc:
        raise ValueError("SIDECAR_ERROR: unavailable") from exc
    except SidecarConversionError as exc:
        raise ValueError(f"SIDECAR_ERROR: {exc}") from exc

    from ....services.patch_utils import apply_single_replacement

    rr = apply_single_replacement(markdown, old_text, new_text)
    if not rr.success:
        raise ValueError(rr.code or rr.reason or "patch failed")

    try:
        next_doc = await ctx.sidecar.markdown_to_doc(rr.content)
    except SidecarUnavailableError as exc:
        raise ValueError("SIDECAR_ERROR: unavailable") from exc
    except SidecarConversionError as exc:
        raise ValueError(f"SIDECAR_ERROR: {exc}") from exc

    restore_image_asset_ids(next_doc, doc)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="manuscript",
        object_id=object_id,
        data={"doc": next_doc, "wordCount": len(rr.content.split())},
        language=ctx.language,
        user_request="tool:translate_patch_manuscript",
        created_by=ctx.user_id,
        create_new_version=False,
    )
    return make_result("Patched translation manuscript", object_id=str(object_id), object_type="manuscript")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register(registry: ToolRegistry) -> None:
    # -- Story object --
    registry.register_tool(
        ToolSpec(
            name="translate_story_object",
            description="Translate story object fields.",
            parameters=obj_schema(
                {"id": _ID, "type": _STORY_TYPE, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}},
                ["id", "type"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="replace",
            validators=(_validate_story_object_exists,),
            executor=_execute_translate_story_object,
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_patch_story_object",
            description="Patch story object translation by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "type": _STORY_TYPE,
                    "field": {"type": "string", "enum": ["name", "description", "content"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["id", "type", "field", "old", "new"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="patch",
            validators=(_validate_patch_story_object,),
            executor=_execute_translate_patch_story_object,
        )
    )

    # -- Basic info --
    registry.register_tool(
        ToolSpec(
            name="translate_basic_info",
            description="Translate project basic info.",
            parameters=obj_schema(
                {"title": {"type": "string"}, "logline": {"type": "string"}, "genre": {"type": "string"}},
                [],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="replace",
            validators=(_validate_basic_info_exists,),
            executor=_execute_translate_basic_info,
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_patch_basic_info",
            description="Patch basic info translation by single replacement.",
            parameters=obj_schema(
                {
                    "field": {"type": "string", "enum": ["title", "logline", "genre"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["field", "old", "new"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="patch",
            validators=(_validate_patch_basic_info,),
            executor=_execute_translate_patch_basic_info,
        )
    )

    # -- Guidelines --
    registry.register_tool(
        ToolSpec(
            name="translate_guidelines",
            description="Translate guidelines.",
            parameters=obj_schema({"id": _ID, "authorNote": {"type": "string"}}, ["id", "authorNote"]),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="replace",
            validators=(_validate_guidelines_exists,),
            executor=_execute_translate_guidelines,
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_patch_guidelines",
            description="Patch guidelines translation by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "field": {"type": "string", "enum": ["authorNote"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["id", "field", "old", "new"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="patch",
            validators=(_validate_patch_guidelines,),
            executor=_execute_translate_patch_guidelines,
        )
    )

    # -- Outline --
    registry.register_tool(
        ToolSpec(
            name="translate_outline",
            description="Translate outline fields.",
            parameters=obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}}, ["id"]),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="replace",
            validators=(_make_exists_validator("replace_outline"),),
            executor=lambda args, ctx: _execute_translate_outline("translate_outline", args, ctx),
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_outline_act",
            description="Translate act fields.",
            parameters=obj_schema(
                {"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}},
                ["id"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="replace",
            validators=(_make_exists_validator("replace_outline_act"),),
            executor=lambda args, ctx: _execute_translate_outline("translate_outline_act", args, ctx),
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_outline_chapter",
            description="Translate chapter fields.",
            parameters=obj_schema(
                {"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}},
                ["id"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="replace",
            validators=(_make_exists_validator("replace_outline_chapter"),),
            executor=lambda args, ctx: _execute_translate_outline("translate_outline_chapter", args, ctx),
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_patch_outline",
            description="Patch outline translation by single replacement.",
            parameters=obj_schema(
                {"id": _ID, "field": {"type": "string", "enum": ["name", "description", "content"]}, "old": {"type": "string"}, "new": {"type": "string"}},
                ["id", "field", "old", "new"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="patch",
            validators=(_make_patch_validator("patch_outline", {"name", "description", "content"}),),
            executor=lambda args, ctx: _execute_translate_patch_outline("translate_patch_outline", args, ctx),
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_patch_outline_act",
            description="Patch act translation by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "field": {"type": "string", "enum": ["name", "description", "content"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["id", "field", "old", "new"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="patch",
            validators=(_make_patch_validator("patch_outline_act", {"name", "description", "content"}),),
            executor=lambda args, ctx: _execute_translate_patch_outline("translate_patch_outline_act", args, ctx),
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_patch_outline_chapter",
            description="Patch chapter translation by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "field": {"type": "string", "enum": ["name", "description", "content"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["id", "field", "old", "new"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="patch",
            validators=(_make_patch_validator("patch_outline_chapter", {"name", "description", "content"}),),
            executor=lambda args, ctx: _execute_translate_patch_outline("translate_patch_outline_chapter", args, ctx),
        )
    )

    # -- Manuscript --
    registry.register_tool(
        ToolSpec(
            name="translate_manuscript",
            description="Translate full manuscript content.",
            parameters=obj_schema({"id": _ID, "content": {"type": "string"}}, ["id", "content"]),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="replace",
            validators=(_validate_manuscript_exists,),
            executor=_execute_translate_manuscript,
        )
    )
    registry.register_tool(
        ToolSpec(
            name="translate_patch_manuscript",
            description="Patch manuscript translation by single replacement.",
            parameters=obj_schema(
                {"id": _ID, "old": {"type": "string"}, "new": {"type": "string"}},
                ["id", "old", "new"],
            ),
            tool_sets=_TRANSLATION_TOOL_SET,
            auto_approve_category="patch",
            validators=(_validate_patch_manuscript,),
            executor=_execute_translate_patch_manuscript,
        )
    )

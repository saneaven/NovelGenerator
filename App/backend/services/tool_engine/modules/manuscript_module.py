from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolValidationContext
from ..contracts import ToolSpec
from ..registry import ToolRegistry
from ..result_utils import invalid_result, make_result, valid_result
from .common_object_helpers import extract_lang_data, obj_schema, read_object, to_uuid
from ....services.object_service import object_service
from ....services.patch_utils import apply_single_replacement
from ....services.sidecar_client import SidecarConversionError, SidecarUnavailableError


_ID = {"type": "string", "description": "Object ID"}


def _validate_manuscript_exists(args: dict[str, Any], ctx: ToolValidationContext):
    try:
        object_id = to_uuid(args.get("id"), "id")
    except ValueError as exc:
        return invalid_result("validate_manuscript_exists", str(exc))

    obj = object_service.get_object(
        ctx.db,
        object_type="manuscript",
        object_id=object_id,
        project_id=ctx.project_id,
        language=ctx.language,
    )
    if obj is None:
        return invalid_result("validate_manuscript_exists", f"manuscript not found: {object_id}")
    return valid_result()


def _validate_patch_manuscript(args: dict[str, Any], ctx: ToolValidationContext):
    old_text = args.get("old")
    new_text = args.get("new")
    if not isinstance(old_text, str) or not isinstance(new_text, str):
        return invalid_result("validate_patch_manuscript", "old and new must be string")

    exists = _validate_manuscript_exists(args, ctx)
    if not exists.valid:
        return exists

    if ctx.sidecar is None:
        return invalid_result("validate_patch_manuscript", "SIDECAR_ERROR: sidecar client unavailable")

    object_id = to_uuid(args.get("id"), "id")
    obj = read_object(ctx.db, ctx.project_id, "manuscript", object_id, ctx.language)
    lang_data = extract_lang_data(obj, ctx.language)
    doc = lang_data.get("doc")
    if not isinstance(doc, dict):
        return invalid_result("validate_patch_manuscript", "MANUSCRIPT_EMPTY")

    async def _check() -> Any:
        try:
            markdown = await ctx.sidecar.doc_to_markdown(doc)
        except SidecarUnavailableError:
            return invalid_result("validate_patch_manuscript", "SIDECAR_ERROR: unavailable")
        except SidecarConversionError as exc:
            return invalid_result("validate_patch_manuscript", f"SIDECAR_ERROR: {exc}")

        rr = apply_single_replacement(markdown, old_text, new_text)
        if not rr.success:
            return invalid_result("validate_patch_manuscript", rr.code or rr.reason or "patch failed")
        return valid_result()

    return _check()


async def _execute_read_manuscript(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    obj = read_object(ctx.db, ctx.project_id, "manuscript", object_id, ctx.language)
    lang_data = extract_lang_data(obj, ctx.language)

    doc = lang_data.get("doc")
    content = ""
    if isinstance(doc, dict) and ctx.sidecar is not None:
        try:
            content = await ctx.sidecar.doc_to_markdown(doc)
        except (SidecarUnavailableError, SidecarConversionError):
            content = ""

    result_obj: dict[str, Any] = {"content": content}
    return make_result("Read successful", object_id=str(object_id), object_type="manuscript", data={"object": result_obj})


async def _execute_replace_manuscript(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    content = str(args.get("content") or "")

    if ctx.sidecar is None:
        raise ValueError("SIDECAR_ERROR: sidecar client unavailable")
    doc = await ctx.sidecar.markdown_to_doc(content)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="manuscript",
        object_id=object_id,
        data={"doc": doc, "wordCount": len(content.split())},
        language=ctx.language,
        user_request="tool:replace_manuscript",
        created_by=ctx.user_id,
    )
    return make_result("Replaced manuscript", object_id=str(object_id), object_type="manuscript")


async def _execute_patch_manuscript(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
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

    rr = apply_single_replacement(markdown, old_text, new_text)
    if not rr.success:
        raise ValueError(rr.code or rr.reason or "patch failed")

    try:
        next_doc = await ctx.sidecar.markdown_to_doc(rr.content)
    except SidecarUnavailableError as exc:
        raise ValueError("SIDECAR_ERROR: unavailable") from exc
    except SidecarConversionError as exc:
        raise ValueError(f"SIDECAR_ERROR: {exc}") from exc

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="manuscript",
        object_id=object_id,
        data={"doc": next_doc, "wordCount": len(rr.content.split())},
        language=ctx.language,
        user_request="tool:patch_manuscript",
        created_by=ctx.user_id,
    )
    return make_result("Patched manuscript", object_id=str(object_id), object_type="manuscript")


def register(registry: ToolRegistry) -> None:
    registry.register_tool(
        ToolSpec(
            name="read_manuscript",
            description="Read manuscript text.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "offset": {
                        "type": "object",
                        "properties": {"from": {"type": "integer"}, "to": {"type": "integer"}},
                        "required": ["from", "to"],
                    },
                },
                ["id"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "agent_plan_mode"}),
            auto_approve_category="read",
            validators=(_validate_manuscript_exists,),
            executor=_execute_read_manuscript,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="replace_manuscript",
            description="Replace full manuscript content.",
            parameters=obj_schema({"id": _ID, "content": {"type": "string"}}, ["id", "content"]),
            tool_sets=frozenset({"agent_agent_mode", "manuscript", "objectTranslation"}),
            auto_approve_category="replace",
            validators=(_validate_manuscript_exists,),
            executor=_execute_replace_manuscript,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="patch_manuscript",
            description="Patch manuscript by single replacement.",
            parameters=obj_schema(
                {"id": _ID, "old": {"type": "string"}, "new": {"type": "string"}},
                ["id", "old", "new"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "manuscript", "objectTranslation"}),
            auto_approve_category="patch",
            validators=(_validate_patch_manuscript,),
            executor=_execute_patch_manuscript,
        )
    )

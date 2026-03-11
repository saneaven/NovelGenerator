from __future__ import annotations

from typing import Any
from uuid import UUID

from ..contexts import ToolExecutionContext, ToolValidationContext
from ....services.manuscript_image_index_service import restore_image_asset_ids
from ....services.object_service import object_service
from ....services.patch_utils import apply_single_replacement
from ....services.sidecar_client import SidecarConversionError, SidecarUnavailableError
from .object_access import extract_lang_data, read_object


def read_manuscript_object(*, db, project_id: UUID, object_id: UUID, language: str) -> dict[str, Any]:
    return read_object(
        db,
        project_id=project_id,
        object_type="manuscript",
        object_id=object_id,
        language=language,
    )


def ensure_manuscript_exists(*, db, project_id: UUID, object_id: UUID, language: str) -> None:
    obj = object_service.get_object(
        db,
        object_type="manuscript",
        object_id=object_id,
        project_id=project_id,
        language=language,
    )
    if obj is None:
        raise ValueError(f"manuscript not found: {object_id}")


async def read_manuscript_markdown(*, db, project_id: UUID, object_id: UUID, language: str, sidecar) -> tuple[dict[str, Any], str]:
    obj = read_manuscript_object(db=db, project_id=project_id, object_id=object_id, language=language)
    lang_data = extract_lang_data(obj, language)
    doc = lang_data.get("doc")
    content = ""
    if isinstance(doc, dict) and sidecar is not None:
        try:
            content = await sidecar.doc_to_markdown(doc)
        except (SidecarUnavailableError, SidecarConversionError):
            content = ""
    return obj, content


async def validate_patch_args(*, args: dict[str, Any], ctx: ToolValidationContext, object_id: UUID) -> None:
    old_text = args.get("old")
    new_text = args.get("new")
    if not isinstance(old_text, str) or not isinstance(new_text, str):
        raise ValueError("old and new must be string")
    if ctx.sidecar is None:
        raise ValueError("SIDECAR_ERROR: sidecar client unavailable")

    obj = read_manuscript_object(db=ctx.db, project_id=ctx.project_id, object_id=object_id, language=ctx.language)
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


async def replace_manuscript(
    *,
    args: dict[str, Any],
    ctx: ToolExecutionContext,
    object_id: UUID,
    user_request: str,
    create_new_version: bool,
) -> dict[str, Any]:
    content = str(args.get("content") or "")
    if ctx.sidecar is None:
        raise ValueError("SIDECAR_ERROR: sidecar client unavailable")

    obj = read_manuscript_object(db=ctx.db, project_id=ctx.project_id, object_id=object_id, language=ctx.language)
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
        user_request=user_request,
        created_by=ctx.user_id,
        create_new_version=create_new_version,
    )
    return {"content": content}


async def patch_manuscript(
    *,
    args: dict[str, Any],
    ctx: ToolExecutionContext,
    object_id: UUID,
    user_request: str,
    create_new_version: bool,
) -> dict[str, Any]:
    if ctx.sidecar is None:
        raise ValueError("SIDECAR_ERROR: sidecar client unavailable")

    old_text = str(args.get("old") or "")
    new_text = str(args.get("new") or "")

    obj = read_manuscript_object(db=ctx.db, project_id=ctx.project_id, object_id=object_id, language=ctx.language)
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

    restore_image_asset_ids(next_doc, doc)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="manuscript",
        object_id=object_id,
        data={"doc": next_doc, "wordCount": len(rr.content.split())},
        language=ctx.language,
        user_request=user_request,
        created_by=ctx.user_id,
        create_new_version=create_new_version,
    )
    return {"content": rr.content}

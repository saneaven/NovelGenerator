from __future__ import annotations

from typing import Any
from uuid import UUID

from ..contexts import ToolExecutionContext, ToolValidationContext
from ....services.object_service import object_service
from ....services.patch_utils import apply_single_replacement
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


async def read_manuscript_markdown(*, db, project_id: UUID, object_id: UUID, language: str) -> tuple[dict[str, Any], str]:
    obj = object_service.get_object(
        db,
        object_type="manuscript",
        object_id=object_id,
        project_id=project_id,
        language=language,
        rich_text_format="markdown",
    )
    if obj is None:
        raise ValueError(f"manuscript not found: {object_id}")
    lang_data = extract_lang_data(obj, language)
    return obj, str(lang_data.get("content") or "")


async def validate_patch_args(*, args: dict[str, Any], ctx: ToolValidationContext, object_id: UUID) -> None:
    old_text = args.get("old")
    new_text = args.get("new")
    if not isinstance(old_text, str) or not isinstance(new_text, str):
        raise ValueError("old and new must be string")
    obj = object_service.get_object(
        ctx.db,
        object_type="manuscript",
        object_id=object_id,
        project_id=ctx.project_id,
        language=ctx.language,
        rich_text_format="markdown",
    )
    if obj is None:
        raise ValueError(f"manuscript not found: {object_id}")
    lang_data = extract_lang_data(obj, ctx.language)
    markdown = str(lang_data.get("content") or "")
    if not markdown:
        raise ValueError("MANUSCRIPT_EMPTY")

    rr = apply_single_replacement(markdown, old_text, new_text)
    if not rr.success:
        raise ValueError(rr.reason or rr.code or "patch failed")


async def replace_manuscript(
    *,
    args: dict[str, Any],
    ctx: ToolExecutionContext,
    object_id: UUID,
    user_request: str,
    create_new_version: bool,
) -> dict[str, Any]:
    content = str(args.get("content") or "")

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="manuscript",
        object_id=object_id,
        data={"content": content},
        language=ctx.language,
        rich_text_format="markdown",
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
    old_text = str(args.get("old") or "")
    new_text = str(args.get("new") or "")

    obj = object_service.get_object(
        ctx.db,
        object_type="manuscript",
        object_id=object_id,
        project_id=ctx.project_id,
        language=ctx.language,
        rich_text_format="markdown",
    )
    if obj is None:
        raise ValueError(f"manuscript not found: {object_id}")
    lang_data = extract_lang_data(obj, ctx.language)
    markdown = str(lang_data.get("content") or "")
    if not markdown:
        raise ValueError("MANUSCRIPT_EMPTY")

    rr = apply_single_replacement(markdown, old_text, new_text)
    if not rr.success:
        raise ValueError(rr.reason or rr.code or "patch failed")

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="manuscript",
        object_id=object_id,
        data={"content": rr.content},
        language=ctx.language,
        rich_text_format="markdown",
        user_request=user_request,
        created_by=ctx.user_id,
        create_new_version=create_new_version,
    )
    return {"content": rr.content}

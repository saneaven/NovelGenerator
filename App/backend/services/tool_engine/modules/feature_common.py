from __future__ import annotations

from typing import Any, Callable
from uuid import UUID

from ..contexts import ToolGroupExecutionContext, ToolModuleContext
from ..contracts import (
    ToolBinding,
    ToolDecisionGroup,
    ToolDecisionItem,
    ToolExecutionOutcome,
    ToolExecutionResult,
)
from ..result_utils import make_result


def binding_allowed(ctx: ToolModuleContext, binding: ToolBinding) -> bool:
    grants = ctx.access_policy.feature_categories
    if grants is None:
        return True
    allowed = grants.get(binding.meta.feature_key)
    return allowed is not None and binding.meta.category in allowed


def filter_allowed_bindings(ctx: ToolModuleContext, bindings: list[ToolBinding]) -> list[ToolBinding]:
    return [binding for binding in bindings if binding_allowed(ctx, binding)]


def merge_key_for(category: str, *, target_kind: str, target_id: str | None, language: str) -> str | None:
    if not target_id:
        return None
    bucket = "translation" if category == "translate" else "draft"
    return f"{target_kind}:{target_id}:{language}:{bucket}"


def _required_target_id(item: ToolDecisionItem) -> UUID:
    value = None
    try:
        value = UUID(str(item.meta.target_id))
    except (TypeError, ValueError):
        value = None
    if value is None:
        raise ValueError(f"Missing target_id for tool call {item.tool_call_id}")
    return value


async def apply_object_batch_group(
    *,
    group: ToolDecisionGroup,
    ctx: ToolGroupExecutionContext,
    object_type_for_item: Callable[[ToolDecisionItem], str],
    replace_fields_for_item: Callable[[ToolDecisionItem], dict[str, Any]],
    metadata_for_item: Callable[[ToolDecisionItem], dict[str, Any] | None],
    result_for_item: Callable[[ToolDecisionItem], dict[str, Any]],
) -> list[ToolExecutionResult]:
    from ....services.object_patch_batch import ObjectPatchBatch
    from ....services.object_service import object_service

    batch = ObjectPatchBatch()
    key_by_call_id: dict[UUID, str] = {}

    for item in group.items:
        object_type = object_type_for_item(item)
        object_id = _required_target_id(item)
        create_new_version = item.meta.category != "translate"
        metadata = metadata_for_item(item)

        if item.meta.op in {"patch", "patch_translation"}:
            result = batch.apply_patch(
                db=ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                language=ctx.language,
                field=str(item.args.get("field") or ""),
                old_text=str(item.args.get("old") or ""),
                new_text=str(item.args.get("new") or ""),
                call_id=str(item.tool_call_id),
                create_new_version=create_new_version,
                user_id=ctx.user_id,
                metadata=metadata,
            )
        elif item.meta.op in {"replace", "translate"}:
            result = batch.apply_replace(
                db=ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                language=ctx.language,
                fields=replace_fields_for_item(item),
                call_id=str(item.tool_call_id),
                create_new_version=create_new_version,
                user_id=ctx.user_id,
                metadata=metadata,
            )
        else:
            raise ValueError(f"Unsupported grouped object op: {item.meta.op}")

        if not result.get("success"):
            raise ValueError(str(result.get("reason") or "Object batch apply failed"))

        key_by_call_id[item.tool_call_id] = ObjectPatchBatch.make_key(object_type, object_id, ctx.language)

    flush_results, _ = batch.flush_all(
        db=ctx.db,
        object_service=object_service,
        created_by=ctx.user_id,
    )

    out: list[ToolExecutionResult] = []
    for item in group.items:
        state_key = key_by_call_id[item.tool_call_id]
        flush_result = flush_results.get(state_key)
        if flush_result is None or not flush_result.success:
            raise ValueError((flush_result.reason if flush_result is not None else None) or "Object batch flush failed")
        out.append(
            ToolExecutionResult(
                tool_call_id=item.tool_call_id,
                outcome=ToolExecutionOutcome(
                    lifecycle="applied",
                    result=result_for_item(item),
                ),
            )
        )
    return out


async def apply_manuscript_batch_group(
    *,
    group: ToolDecisionGroup,
    ctx: ToolGroupExecutionContext,
    result_for_item: Callable[[ToolDecisionItem], dict[str, Any]],
) -> list[ToolExecutionResult]:
    from ....services.manuscript_batch import ManuscriptBatch
    from ....services.object_service import object_service

    batch = ManuscriptBatch()
    key_by_call_id: dict[UUID, str] = {}

    for item in group.items:
        manuscript_id = _required_target_id(item)
        create_new_version = item.meta.category != "translate"
        if item.meta.op in {"patch", "patch_translation"}:
            result = await batch.apply_patch(
                db=ctx.db,
                manuscript_id=manuscript_id,
                project_id=ctx.project_id,
                language=ctx.language,
                old_text=str(item.args.get("old") or ""),
                new_text=str(item.args.get("new") or ""),
                call_id=str(item.tool_call_id),
                create_new_version=create_new_version,
                user_request=f"tool:{item.binding.spec.name}",
            )
        elif item.meta.op in {"replace", "translate"}:
            result = await batch.apply_replace(
                manuscript_id=manuscript_id,
                project_id=ctx.project_id,
                language=ctx.language,
                content=str(item.args.get("content") or ""),
                call_id=str(item.tool_call_id),
                create_new_version=create_new_version,
                user_request=f"tool:{item.binding.spec.name}",
            )
        else:
            raise ValueError(f"Unsupported grouped manuscript op: {item.meta.op}")

        if not result.get("success"):
            raise ValueError(str(result.get("reason") or "Manuscript batch apply failed"))

        key_by_call_id[item.tool_call_id] = ManuscriptBatch.make_key(
            manuscript_id,
            ctx.language,
            create_new_version,
        )

    flush_results, _ = await batch.flush_all(
        db=ctx.db,
        object_service=object_service,
        created_by=ctx.user_id,
    )

    out: list[ToolExecutionResult] = []
    for item in group.items:
        state_key = key_by_call_id[item.tool_call_id]
        flush_result = flush_results.get(state_key)
        if flush_result is None or not flush_result.success:
            raise ValueError((flush_result.reason if flush_result is not None else None) or "Manuscript batch flush failed")
        out.append(
            ToolExecutionResult(
                tool_call_id=item.tool_call_id,
                outcome=ToolExecutionOutcome(
                    lifecycle="applied",
                    result=result_for_item(item),
                ),
            )
        )
    return out


def generic_group_result(item: ToolDecisionItem) -> dict[str, Any]:
    return make_result(
        f"Applied {item.binding.spec.name}",
        object_id=item.meta.target_id,
        object_type=item.meta.target_kind,
    )

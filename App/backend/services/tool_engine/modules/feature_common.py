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


def _failure_payload(reason: str) -> dict[str, Any]:
    return {"success": False, "message": reason, "error": reason}


def _failure_reason_from_result(result: dict[str, Any], default: str) -> str:
    for key in ("reason", "error", "message", "code"):
        value = result.get(key)
        if value:
            return str(value)
    return default


def _failed_result(item: ToolDecisionItem, reason: str) -> ToolExecutionResult:
    return ToolExecutionResult(
        tool_call_id=item.tool_call_id,
        outcome=ToolExecutionOutcome(
            lifecycle="failed",
            reason=reason,
            result=_failure_payload(reason),
        ),
    )


def _applied_result(
    item: ToolDecisionItem,
    result_for_item: Callable[[ToolDecisionItem], dict[str, Any]],
) -> ToolExecutionResult:
    return ToolExecutionResult(
        tool_call_id=item.tool_call_id,
        outcome=ToolExecutionOutcome(
            lifecycle="applied",
            result=result_for_item(item),
        ),
    )


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
    outcomes_by_id: dict[UUID, ToolExecutionResult] = {}
    successful_items: list[ToolDecisionItem] = []

    for item in group.items:
        try:
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
        except Exception as exc:
            outcomes_by_id[item.tool_call_id] = _failed_result(item, str(exc))
            continue

        if not result.get("success"):
            reason = _failure_reason_from_result(result, "Object batch apply failed")
            outcomes_by_id[item.tool_call_id] = _failed_result(item, reason)
            continue

        key_by_call_id[item.tool_call_id] = ObjectPatchBatch.make_key(object_type, object_id, ctx.language)
        successful_items.append(item)

    if successful_items:
        try:
            flush_results, _ = batch.flush_all(
                db=ctx.db,
                object_service=object_service,
                created_by=ctx.user_id,
            )
        except Exception as exc:
            for item in successful_items:
                outcomes_by_id[item.tool_call_id] = _failed_result(item, str(exc))
        else:
            for item in successful_items:
                state_key = key_by_call_id[item.tool_call_id]
                flush_result = flush_results.get(state_key)
                if flush_result is None or not flush_result.success:
                    reason = (flush_result.reason if flush_result is not None else None) or "Object batch flush failed"
                    outcomes_by_id[item.tool_call_id] = _failed_result(item, reason)
                    continue
                outcomes_by_id[item.tool_call_id] = _applied_result(item, result_for_item)

    return [
        outcomes_by_id[item.tool_call_id]
        for item in group.items
        if item.tool_call_id in outcomes_by_id
    ]


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
    outcomes_by_id: dict[UUID, ToolExecutionResult] = {}
    successful_items: list[ToolDecisionItem] = []

    for item in group.items:
        try:
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
        except Exception as exc:
            outcomes_by_id[item.tool_call_id] = _failed_result(item, str(exc))
            continue

        if not result.get("success"):
            reason = _failure_reason_from_result(result, "Manuscript batch apply failed")
            outcomes_by_id[item.tool_call_id] = _failed_result(item, reason)
            continue

        key_by_call_id[item.tool_call_id] = ManuscriptBatch.make_key(
            manuscript_id,
            ctx.language,
            create_new_version,
        )
        successful_items.append(item)

    if successful_items:
        try:
            flush_results, _ = await batch.flush_all(
                db=ctx.db,
                object_service=object_service,
                created_by=ctx.user_id,
            )
        except Exception as exc:
            for item in successful_items:
                outcomes_by_id[item.tool_call_id] = _failed_result(item, str(exc))
        else:
            for item in successful_items:
                state_key = key_by_call_id[item.tool_call_id]
                flush_result = flush_results.get(state_key)
                if flush_result is None or not flush_result.success:
                    reason = (flush_result.reason if flush_result is not None else None) or "Manuscript batch flush failed"
                    outcomes_by_id[item.tool_call_id] = _failed_result(item, reason)
                    continue
                outcomes_by_id[item.tool_call_id] = _applied_result(item, result_for_item)

    return [
        outcomes_by_id[item.tool_call_id]
        for item in group.items
        if item.tool_call_id in outcomes_by_id
    ]


def generic_group_result(item: ToolDecisionItem) -> dict[str, Any]:
    return make_result(
        f"Applied {item.binding.spec.name}",
        object_id=item.meta.target_id,
        object_type=item.meta.target_kind,
    )

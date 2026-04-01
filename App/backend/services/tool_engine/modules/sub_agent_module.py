from __future__ import annotations

import json
from datetime import datetime

from ....models.db_models import SubAgentDefinitionModel, Thread
from ..contracts import PersistedToolMeta, ToolBinding, ToolBindingMeta, ToolExecutionOutcome, ToolFeatureModule, ToolSpec
from ..registry import tool_feature_module
from ..result_utils import invalid_result, valid_result
from .feature_common import filter_allowed_bindings
from .shared import filter_allowed_specs, is_non_journey, obj_schema


def _resolve_definition(*, db, user_id, preset_id, agent_name: str):
    return (
        db.query(SubAgentDefinitionModel)
        .filter(
            SubAgentDefinitionModel.user_id == user_id,
            SubAgentDefinitionModel.preset_id == preset_id,
            SubAgentDefinitionModel.agent_name == agent_name,
            SubAgentDefinitionModel.enabled == True,  # noqa: E712
        )
        .first()
    )


def _invocation_allowed(definition: SubAgentDefinitionModel, invocation_mode: str) -> bool:
    modes = definition.allowed_invocation_modes or []
    if not isinstance(modes, list):
        return False
    return invocation_mode in {str(m) for m in modes if isinstance(m, str)}


def _sub_agent_specs(ctx) -> list[ToolSpec]:
    if not is_non_journey(ctx):
        return []

    q = (
        ctx.db.query(SubAgentDefinitionModel)
        .filter(
            SubAgentDefinitionModel.user_id == ctx.user_id,
            SubAgentDefinitionModel.preset_id == ctx.preset_id,
            SubAgentDefinitionModel.enabled == True,  # noqa: E712
        )
    )
    if ctx.allowed_sub_agent_ids is not None:
        if len(ctx.allowed_sub_agent_ids) == 0:
            return []
        q = q.filter(SubAgentDefinitionModel.id.in_(ctx.allowed_sub_agent_ids))

    specs: list[ToolSpec] = []
    for definition in q.order_by(SubAgentDefinitionModel.agent_name.asc()).all():
        if not _invocation_allowed(definition, ctx.invocation_mode):
            continue
        display = (definition.display_name or definition.agent_name or "").strip() or definition.agent_name
        description = (definition.description or "").strip()
        base = f'Call Sub Agent "{display}".'
        specs.append(
            ToolSpec(
                name=f"call_{definition.agent_name}",
                description=f"{base} {description}" if description else base,
                parameters=obj_schema(
                    {
                        "input": {
                            "type": "string",
                            "description": "Input for the sub-agent. Include complete context and instructions.",
                        }
                    },
                    ["input"],
                ),
                auto_approve_category="call",
            )
        )
    return filter_allowed_specs(ctx, specs)


@tool_feature_module()
class SubAgentFeatureModule(ToolFeatureModule):
    feature_key = "sub_agent"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        bindings: list[ToolBinding] = []
        for spec in _sub_agent_specs(ctx):
            tool_name = spec.name
            agent_name = tool_name[len("call_"):]

            async def _validate(args, validation_ctx, _agent_name=agent_name):
                allowed_sub_agent_ids = validation_ctx.access_policy.allowed_sub_agent_ids
                value = args.get("input")
                if not isinstance(value, str) or not value.strip():
                    return invalid_result("validate_call_input", 'call_* tools require a non-empty string field "input".')
                if validation_ctx.preset_id is None:
                    return invalid_result("validate_call_exists", "No active preset configured")
                definition = _resolve_definition(
                    db=validation_ctx.db,
                    user_id=validation_ctx.user_id,
                    preset_id=validation_ctx.preset_id,
                    agent_name=_agent_name,
                )
                if definition is None:
                    return invalid_result("validate_call_exists", f"Sub-agent not found: {_agent_name}")
                mode = str(validation_ctx.invocation_mode or "")
                if not _invocation_allowed(definition, mode):
                    return invalid_result("validate_call_mode", f"Sub-agent not invocable in mode: {mode}")
                if validation_ctx.thread.thread_type == "subAgent" and allowed_sub_agent_ids is not None and definition.id not in allowed_sub_agent_ids:
                    return invalid_result("validate_call_permission", f"Sub-agent not allowed: {_agent_name}")
                return valid_result()

            async def _execute(args, execution_ctx, _agent_name=agent_name):
                allowed_sub_agent_ids = execution_ctx.access_policy.allowed_sub_agent_ids
                if execution_ctx.preset_id is None:
                    raise ValueError("No active preset configured")
                definition = _resolve_definition(
                    db=execution_ctx.db,
                    user_id=execution_ctx.user_id,
                    preset_id=execution_ctx.preset_id,
                    agent_name=_agent_name,
                )
                if definition is None:
                    raise ValueError(f"Sub-agent not found: {_agent_name}")
                mode = str(execution_ctx.invocation_mode or "")
                if not _invocation_allowed(definition, mode):
                    raise ValueError(f"Sub-agent not invocable in mode: {mode}")
                if execution_ctx.thread.thread_type == "subAgent" and allowed_sub_agent_ids is not None and definition.id not in allowed_sub_agent_ids:
                    raise ValueError(f"Sub-agent not allowed: {_agent_name}")

                child_thread = Thread(
                    project_id=execution_ctx.project_id,
                    user_id=execution_ctx.user_id,
                    thread_type="subAgent",
                    parent_id=definition.id,
                    status="waiting",
                )
                execution_ctx.db.add(child_thread)
                execution_ctx.db.flush()

                execution_ctx.tool_call_row.child_thread_id = child_thread.id
                execution_ctx.tool_call_row.status = "processing"
                execution_ctx.tool_call_row.result = {
                    "child_thread_id": str(child_thread.id),
                    "agent_name": _agent_name,
                }
                execution_ctx.tool_call_row.updated_at = datetime.utcnow()
                execution_ctx.db.flush()

                input_text = args.get("input") or ""
                if not isinstance(input_text, str) or not input_text.strip():
                    input_text = json.dumps(args, ensure_ascii=False)

                return ToolExecutionOutcome(
                    lifecycle="working",
                    result={
                        "child_thread_id": str(child_thread.id),
                        "agent_name": _agent_name,
                        "input_text": input_text,
                    },
                    child_thread_id=child_thread.id,
                    child_input_text=input_text,
                )

            bindings.append(
                ToolBinding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="sub_agent",
                        category="sub_agent",
                        op="call",
                        target_kind="sub_agent",
                    ),
                    validate=_validate,
                    execute=_execute,
                    build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
                        feature_key="sub_agent",
                        category="sub_agent",
                        op="call",
                        target_kind="sub_agent",
                        target_id=None,
                        merge_key=None,
                    ),
                )
            )
        return filter_allowed_bindings(ctx, bindings)

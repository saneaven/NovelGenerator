from __future__ import annotations

import json
from datetime import datetime

from ....models.db_models import SubAgentDefinitionModel, Thread
from ..contracts import PersistedToolMeta, ToolBinding, ToolBindingMeta, ToolExecutionOutcome, ToolFeatureModule
from ..registry import tool_feature_module
from ..result_utils import invalid_result
from .call_module import CallToolCallModule, _invocation_allowed, _resolve_definition
from .feature_common import filter_allowed_bindings, legacy_specs_by_name


_CALL = CallToolCallModule()


@tool_feature_module()
class SubAgentFeatureModule(ToolFeatureModule):
    feature_key = "sub_agent"

    def list_bindings(self, ctx) -> list:
        specs = legacy_specs_by_name(_CALL, ctx)
        bindings = []
        for name, spec in specs.items():
            if not name.startswith("call_"):
                continue
            agent_name = name[len("call_"):]

            async def _validate(args, validation_ctx, _tool_name=name, _agent_name=agent_name):
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
                return await _CALL.validate(_tool_name, args, validation_ctx)

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

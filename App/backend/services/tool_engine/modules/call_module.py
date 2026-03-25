from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, valid_result
from ....models.db_models import SubAgentDefinitionModel, Thread
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


@tool_call_module(prefix="call_")
class CallToolCallModule(ToolCallModule):
    dynamic = True

    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("call",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
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

        out: list[ToolSpec] = []
        for definition in q.order_by(SubAgentDefinitionModel.agent_name.asc()).all():
            if not _invocation_allowed(definition, ctx.invocation_mode):
                continue
            display = (definition.display_name or definition.agent_name or "").strip() or definition.agent_name
            description = (definition.description or "").strip()
            base = f'Call Sub Agent "{display}".'
            out.append(
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
        return filter_allowed_specs(ctx, out)

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        value = args.get("input")
        if not isinstance(value, str) or not value.strip():
            return invalid_result("validate_call_input", 'call_* tools require a non-empty string field "input".')
        if ctx.preset_id is None:
            return invalid_result("validate_call_exists", "No active preset configured")

        agent_name = tool_name[len("call_"):]
        definition = _resolve_definition(
            db=ctx.db,
            user_id=ctx.user_id,
            preset_id=ctx.preset_id,
            agent_name=agent_name,
        )
        if definition is None:
            return invalid_result("validate_call_exists", f"Sub-agent not found: {agent_name}")
        mode = str(ctx.invocation_mode or "")
        if not _invocation_allowed(definition, mode):
            return invalid_result("validate_call_mode", f"Sub-agent not invocable in mode: {mode}")
        if ctx.thread.thread_type == "subAgent" and ctx.allowed_sub_agent_ids is not None and definition.id not in ctx.allowed_sub_agent_ids:
            return invalid_result("validate_call_permission", f"Sub-agent not allowed: {agent_name}")
        return valid_result()

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        if ctx.preset_id is None:
            raise ValueError("No active preset configured")
        agent_name = tool_name[len("call_"):]
        definition = _resolve_definition(
            db=ctx.db,
            user_id=ctx.user_id,
            preset_id=ctx.preset_id,
            agent_name=agent_name,
        )
        if definition is None:
            raise ValueError(f"Sub-agent not found: {agent_name}")
        mode = str(ctx.invocation_mode or "")
        if not _invocation_allowed(definition, mode):
            raise ValueError(f"Sub-agent not invocable in mode: {mode}")
        if ctx.thread.thread_type == "subAgent" and ctx.allowed_sub_agent_ids is not None and definition.id not in ctx.allowed_sub_agent_ids:
            raise ValueError(f"Sub-agent not allowed: {agent_name}")

        child_thread = Thread(
            project_id=ctx.project_id,
            user_id=ctx.user_id,
            thread_type="subAgent",
            parent_id=definition.id,
            status="waiting",
        )
        ctx.db.add(child_thread)
        ctx.db.flush()

        ctx.tool_call_row.child_thread_id = child_thread.id
        ctx.tool_call_row.status = "processing"
        ctx.tool_call_row.result = {
            "child_thread_id": str(child_thread.id),
            "agent_name": agent_name,
        }
        ctx.tool_call_row.updated_at = datetime.utcnow()
        ctx.db.flush()

        input_text = args.get("input") or ""
        if not isinstance(input_text, str) or not input_text.strip():
            input_text = json.dumps(args, ensure_ascii=False)

        return {
            "child_thread_id": str(child_thread.id),
            "agent_name": agent_name,
            "input_text": input_text,
        }

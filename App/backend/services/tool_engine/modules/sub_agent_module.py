from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..contexts import ToolExecutionContext, ToolOfferContext, ToolValidationContext
from ..contracts import ToolSpec, ToolValidator
from ..registry import ToolRegistry
from ..result_utils import invalid_result, valid_result
from .common_object_helpers import obj_schema
from ....models.db_models import SubAgentDefinitionModel, Thread


def _call_tool_description(display_name: str, description: str | None) -> str:
    desc = (description or "").strip()
    base = f'Call Sub Agent "{display_name}".'
    return f"{base} {desc}" if desc else base


def _resolve_definition(
    *,
    db,
    user_id,
    preset_id,
    agent_name: str,
):
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


def _make_call_validator(agent_name: str) -> ToolValidator:
    def _validator(args: dict[str, Any], ctx: ToolValidationContext):
        value = args.get("input")
        if not isinstance(value, str) or not value.strip():
            return invalid_result("validate_sub_agent_input", 'call_* tools require a non-empty string field "input".')

        if ctx.preset_id is None:
            return invalid_result("validate_sub_agent_exists", "No active preset configured")

        definition = _resolve_definition(
            db=ctx.db,
            user_id=ctx.user_id,
            preset_id=ctx.preset_id,
            agent_name=agent_name,
        )
        if definition is None:
            return invalid_result("validate_sub_agent_exists", f"Sub-agent not found: {agent_name}")

        mode = str(ctx.invocation_mode or "")
        if not _invocation_allowed(definition, mode):
            return invalid_result("validate_sub_agent_mode", f"Sub-agent not invocable in mode: {mode}")

        if ctx.thread.thread_type == "subAgent" and ctx.allowed_sub_agent_ids is not None:
            if definition.id not in ctx.allowed_sub_agent_ids:
                return invalid_result("validate_sub_agent_permission", f"Sub-agent not allowed: {agent_name}")

        return valid_result()

    return _validator


def _make_call_executor(agent_name: str):
    async def _executor(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        if ctx.preset_id is None:
            raise ValueError("No active preset configured")

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

        if ctx.thread.thread_type == "subAgent" and ctx.allowed_sub_agent_ids is not None:
            if definition.id not in ctx.allowed_sub_agent_ids:
                raise ValueError(f"Sub-agent not allowed: {agent_name}")

        child_thread = Thread(
            project_id=ctx.project_id,
            user_id=ctx.user_id,
            thread_type="subAgent",
            owner_id=definition.id,
            status="waiting",
        )
        ctx.db.add(child_thread)
        ctx.db.flush()

        tool_call = ctx.tool_call_row
        tool_call.child_thread_id = child_thread.id
        tool_call.status = "processing"
        tool_call.result = {
            "child_thread_id": str(child_thread.id),
            "agent_name": agent_name,
        }
        tool_call.updated_at = datetime.utcnow()
        ctx.db.flush()

        input_text = args.get("input") or args.get("task") or ""
        if not isinstance(input_text, str) or not input_text.strip():
            input_text = json.dumps(args, ensure_ascii=False)

        return {
            "__continue_as": "working",
            "child_thread_id": str(child_thread.id),
            "agent_name": agent_name,
            "input_text": input_text,
        }

    return _executor


def _build_call_spec(definition: SubAgentDefinitionModel) -> ToolSpec:
    display = (definition.display_name or definition.agent_name or "").strip() or definition.agent_name
    return ToolSpec(
        name=f"call_{definition.agent_name}",
        description=_call_tool_description(display, definition.description),
        parameters=obj_schema(
            {
                "input": {
                    "type": "string",
                    "description": "Input for the sub-agent. Include complete context and instructions.",
                }
            },
            ["input"],
        ),
        tool_sets=frozenset({"agent_plan_mode", "agent_agent_mode"}),
        auto_approve_category="subAgent",
        validators=(_make_call_validator(definition.agent_name),),
        executor=_make_call_executor(definition.agent_name),
    )


class SubAgentToolProvider:
    def build_specs(self, ctx: ToolOfferContext) -> list[ToolSpec]:
        if ctx.thread.thread_type == "journey":
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

        definitions = q.order_by(SubAgentDefinitionModel.agent_name.asc()).all()
        out: list[ToolSpec] = []
        for definition in definitions:
            if not _invocation_allowed(definition, ctx.invocation_mode):
                continue
            out.append(_build_call_spec(definition))
        return out


def register(registry: ToolRegistry) -> None:
    registry.register_provider(SubAgentToolProvider())

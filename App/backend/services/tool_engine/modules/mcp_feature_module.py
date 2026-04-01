from __future__ import annotations

from typing import Any

from ..contracts import PersistedToolMeta, ToolBinding, ToolBindingMeta, ToolExecutionOutcome, ToolFeatureModule, ToolSpec
from ..registry import tool_feature_module
from ..result_utils import invalid_result, valid_result
from .feature_common import filter_allowed_bindings
from .shared import obj_schema
from ...mcp import McpRuntimeContext, mcp_policy_service, mcp_resolver, resolve_mcp_tool_name


def _tool_specs_for_context(ctx) -> list[dict[str, Any]]:
    runtime_ctx = mcp_policy_service.build_runtime_context(
        ctx.db,
        user_id=ctx.user_id,
        preset_id=ctx.preset_id,
        thread=ctx.thread,
        run=ctx.run,
        input_text="",
        input_payload=ctx.input_payload,
    )
    specs: list[dict[str, Any]] = []
    for server in mcp_policy_service.allowed_servers(runtime_ctx):
        snapshot = server.snapshot
        catalog = snapshot.catalog_json if snapshot and isinstance(snapshot.catalog_json, dict) else {}
        for tool in catalog.get("tools") or []:
            if not isinstance(tool, dict):
                continue
            specs.append(
                {
                    "server_id": str(server.id),
                    "server_key": server.server_key,
                    "display_name": server.display_name,
                    **tool,
                }
            )
    return specs


def _build_spec(item: dict[str, Any]) -> ToolSpec | None:
    local_name = str(item.get("local_name") or "").strip()
    if not local_name:
        return None
    remote_name = str(item.get("remote_name") or "").strip()
    display_name = str(item.get("display_name") or item.get("server_key") or "MCP")
    description = str(item.get("description") or "").strip() or f"{display_name}: {remote_name}"
    schema = item.get("input_schema") if isinstance(item.get("input_schema"), dict) else obj_schema({}, [])
    return ToolSpec(
        name=local_name,
        description=description,
        parameters=schema,
        auto_approve_category=None,
    )


@tool_feature_module()
class McpFeatureModule(ToolFeatureModule):
    feature_key = "mcp"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        bindings: list[ToolBinding] = []
        for raw_spec in _tool_specs_for_context(ctx):
            spec = _build_spec(raw_spec)
            if spec is None:
                continue
            tool_name = spec.name

            async def _validate(args, validation_ctx, _tool_name=tool_name):
                try:
                    resolve_mcp_tool_name(_tool_name, tool_specs=_tool_specs_for_context(validation_ctx))
                except Exception as exc:  # noqa: BLE001
                    return invalid_result("validate_mcp_tool_name", str(exc))
                return valid_result()

            async def _execute(args, execution_ctx, _tool_name=tool_name):
                server_id, remote_name = resolve_mcp_tool_name(_tool_name, tool_specs=_tool_specs_for_context(execution_ctx))
                runtime_ctx = McpRuntimeContext(
                    db=execution_ctx.db,
                    user_id=execution_ctx.user_id,
                    preset_id=execution_ctx.preset_id,
                    thread_id=execution_ctx.thread.id,
                    run_id=execution_ctx.run.id,
                    invocation_mode=str(execution_ctx.invocation_mode or "agentMode"),
                    sub_agent_id=execution_ctx.thread.parent_id if execution_ctx.thread.thread_type == "subAgent" else None,
                    language=execution_ctx.language,
                    input_text="",
                    input_payload=execution_ctx.input_payload,
                )
                raw = await mcp_resolver.execute_tool(
                    db=execution_ctx.db,
                    ctx=runtime_ctx,
                    server_id=server_id,
                    remote_name=remote_name,
                    arguments=args,
                    project_id=execution_ctx.project_id,
                )
                safe_result = {key: value for key, value in raw.items() if key != "__extra_content"}
                extra_content_patch = raw.get("__extra_content")
                return ToolExecutionOutcome(
                    lifecycle="applied",
                    result=safe_result,
                    extra_content_patch=extra_content_patch if isinstance(extra_content_patch, dict) else None,
                )

            bindings.append(
                ToolBinding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="mcp",
                        category="mcp",
                        op="mcp",
                        target_kind="mcp_tool",
                    ),
                    validate=_validate,
                    execute=_execute,
                    build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
                        feature_key="mcp",
                        category="mcp",
                        op="mcp",
                        target_kind="mcp_tool",
                        target_id=None,
                        merge_key=None,
                    ),
                )
            )
        return filter_allowed_bindings(ctx, bindings)

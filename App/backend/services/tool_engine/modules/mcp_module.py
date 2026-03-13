from __future__ import annotations

from typing import Any

from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, valid_result
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


@tool_call_module(prefix="mcp__")
class McpToolModule(ToolCallModule):
    dynamic = True

    def list_tools(self, ctx) -> list[ToolSpec]:
        out: list[ToolSpec] = []
        for item in _tool_specs_for_context(ctx):
            local_name = str(item.get("local_name") or "").strip()
            if not local_name:
                continue
            remote_name = str(item.get("remote_name") or "").strip()
            display_name = str(item.get("display_name") or item.get("server_key") or "MCP")
            description = str(item.get("description") or "").strip() or f"{display_name}: {remote_name}"
            schema = item.get("input_schema") if isinstance(item.get("input_schema"), dict) else obj_schema({}, [])
            out.append(
                ToolSpec(
                    name=local_name,
                    description=description,
                    parameters=schema,
                    auto_approve_category=None,
                )
            )
        return out

    async def validate(self, tool_name: str, args: dict[str, Any], ctx) -> Any:
        try:
            resolve_mcp_tool_name(tool_name, tool_specs=_tool_specs_for_context(ctx))
        except Exception as exc:
            return invalid_result("validate_mcp_tool_name", str(exc))
        return valid_result()

    async def execute(self, tool_name: str, args: dict[str, Any], ctx) -> dict[str, Any]:
        server_id, remote_name = resolve_mcp_tool_name(tool_name, tool_specs=_tool_specs_for_context(ctx))
        runtime_ctx = McpRuntimeContext(
            db=ctx.db,
            user_id=ctx.user_id,
            preset_id=ctx.preset_id,
            thread_id=ctx.thread.id,
            run_id=ctx.run.id,
            invocation_mode=str(ctx.invocation_mode or "agentMode"),
            sub_agent_id=ctx.thread.parent_id if ctx.thread.thread_type == "subAgent" else None,
            language=ctx.language,
            input_text="",
            input_payload=ctx.input_payload,
        )
        return await mcp_resolver.execute_tool(
            db=ctx.db,
            ctx=runtime_ctx,
            server_id=server_id,
            remote_name=remote_name,
            arguments=args,
            project_id=ctx.project_id,
        )

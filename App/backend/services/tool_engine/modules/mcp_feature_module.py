from __future__ import annotations

from ..contracts import PersistedToolMeta, ToolBindingMeta, ToolFeatureModule
from ..registry import tool_feature_module
from .feature_common import build_legacy_binding, filter_allowed_bindings, legacy_specs_by_name
from .mcp_module import McpToolModule


_MCP = McpToolModule()


@tool_feature_module()
class McpFeatureModule(ToolFeatureModule):
    feature_key = "mcp"

    def list_bindings(self, ctx) -> list:
        specs = legacy_specs_by_name(_MCP, ctx)
        bindings = []
        for name, spec in specs.items():
            bindings.append(
                build_legacy_binding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="mcp",
                        category="mcp",
                        op="mcp",
                        target_kind="mcp_tool",
                    ),
                    module=_MCP,
                    tool_name=name,
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

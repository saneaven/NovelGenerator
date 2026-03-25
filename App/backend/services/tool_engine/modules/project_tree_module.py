from __future__ import annotations

from ..contracts import PersistedToolMeta, ToolBindingMeta, ToolFeatureModule
from ..registry import tool_feature_module
from .feature_common import build_legacy_binding, filter_allowed_bindings, legacy_specs_by_name
from .tree_module import TreeToolCallModule


_TREE = TreeToolCallModule()


@tool_feature_module()
class ProjectTreeFeatureModule(ToolFeatureModule):
    feature_key = "project_tree"

    def list_bindings(self, ctx) -> list:
        specs = legacy_specs_by_name(_TREE, ctx)
        spec = specs.get("get_project_tree")
        if spec is None:
            return []
        bindings = [
            build_legacy_binding(
                spec=spec,
                meta=ToolBindingMeta(
                    feature_key="project_tree",
                    category="read",
                    op="get_tree",
                    target_kind="project_tree",
                ),
                module=_TREE,
                tool_name="get_project_tree",
                build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
                    feature_key="project_tree",
                    category="read",
                    op="get_tree",
                    target_kind="project_tree",
                    target_id=None,
                    merge_key=None,
                ),
            )
        ]
        return filter_allowed_bindings(ctx, bindings)

from __future__ import annotations

from ..contracts import PersistedToolMeta, ToolBindingMeta, ToolFeatureModule
from ..registry import tool_feature_module
from .feature_common import build_legacy_binding, filter_allowed_bindings, legacy_specs_by_name
from .search_module import SearchToolCallModule


_SEARCH = SearchToolCallModule()


def _persisted_meta(*, op: str):
    def _builder(_ctx, _args):
        return PersistedToolMeta(
            feature_key="search",
            category="read",
            op=op,
            target_kind="project_tree",
            target_id=None,
            merge_key=None,
        )

    return _builder


@tool_feature_module()
class SearchFeatureModule(ToolFeatureModule):
    feature_key = "search"

    def list_bindings(self, ctx) -> list:
        specs = legacy_specs_by_name(_SEARCH, ctx)
        bindings = []
        for name in ("search_keyword", "search_semantic"):
            spec = specs.get(name)
            if spec is None:
                continue
            bindings.append(
                build_legacy_binding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="search",
                        category="read",
                        op="search",
                        target_kind="project_tree",
                    ),
                    module=_SEARCH,
                    tool_name=name,
                    build_persisted_meta=_persisted_meta(op="search"),
                )
            )
        return filter_allowed_bindings(ctx, bindings)

from __future__ import annotations

from .contexts import ToolOfferContext
from .contracts import AutoApproveCategory, ToolOffer, ToolProvider, ToolSpec


class ToolRegistry:
    def __init__(self) -> None:
        self._tools_by_name: dict[str, ToolSpec] = {}
        self._providers: list[ToolProvider] = []

    def register_tool(self, spec: ToolSpec) -> None:
        if spec.name in self._tools_by_name:
            raise ValueError(f"Duplicate tool registration: {spec.name}")
        self._tools_by_name[spec.name] = spec

    def register_provider(self, provider: ToolProvider) -> None:
        self._providers.append(provider)

    def get_registered_tool(self, name: str) -> ToolSpec | None:
        return self._tools_by_name.get(name)

    def build_offer(self, ctx: ToolOfferContext) -> ToolOffer:
        specs_by_name: dict[str, ToolSpec] = {}

        for spec in self._tools_by_name.values():
            if ctx.tool_set_name not in spec.tool_sets:
                continue
            if spec.enabled_when is not None and not spec.enabled_when(ctx):
                continue
            if ctx.allowed_tool_names is not None and spec.name not in ctx.allowed_tool_names:
                continue
            specs_by_name[spec.name] = spec

        for provider in self._providers:
            dynamic_specs = provider.build_specs(ctx)
            for spec in dynamic_specs:
                if ctx.tool_set_name not in spec.tool_sets:
                    continue
                if spec.enabled_when is not None and not spec.enabled_when(ctx):
                    continue
                if spec.name in specs_by_name:
                    raise ValueError(f"Duplicate tool registration in offer: {spec.name}")
                specs_by_name[spec.name] = spec

        provider_tools = [
            {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.parameters,
            }
            for spec in specs_by_name.values()
        ]

        auto_categories: dict[str, AutoApproveCategory] = {}
        for name, spec in specs_by_name.items():
            if spec.auto_approve_category is not None:
                auto_categories[name] = spec.auto_approve_category

        return ToolOffer(
            tool_set_name=ctx.tool_set_name,
            specs_by_name=specs_by_name,
            provider_tools=provider_tools,
            auto_approve_category_by_name=auto_categories,
        )

    def resolve_spec(self, name: str, offer: ToolOffer, ctx: ToolOfferContext) -> ToolSpec | None:
        _ = ctx
        return offer.specs_by_name.get(name)

    def get_auto_approve_category(self, tool_name: str, offer: ToolOffer) -> AutoApproveCategory | None:
        return offer.auto_approve_category_by_name.get(tool_name)

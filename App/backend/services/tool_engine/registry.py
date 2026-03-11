from __future__ import annotations

from .contexts import ToolModuleContext
from .contracts import AutoApproveCategory, ToolCallModule, ToolModuleFactory, ToolOffer, ToolSpec


_REGISTERED_MODULE_FACTORIES: list[ToolModuleFactory] = []


def tool_call_module(*, prefix: str):
    def _decorate(cls: type[ToolCallModule]) -> type[ToolCallModule]:
        cls.prefix = prefix
        _REGISTERED_MODULE_FACTORIES.append(cls)
        return cls

    return _decorate


class ToolRegistry:
    def __init__(self) -> None:
        self._modules_by_prefix: dict[str, ToolCallModule] = {}

    def register_module(self, module: ToolCallModule) -> None:
        prefix = str(getattr(module, "prefix", "") or "")
        if not prefix:
            raise ValueError(f"Tool module {module.__class__.__name__} missing prefix")
        if prefix in self._modules_by_prefix:
            raise ValueError(f"Duplicate tool module prefix: {prefix}")
        self._modules_by_prefix[prefix] = module

    def list_modules(self) -> list[ToolCallModule]:
        return [self._modules_by_prefix[prefix] for prefix in sorted(self._modules_by_prefix.keys(), key=len, reverse=True)]

    def list_auto_approve_categories(self) -> list[AutoApproveCategory]:
        categories: list[AutoApproveCategory] = []
        seen: set[AutoApproveCategory] = set()
        for module in self.list_modules():
            for category in module.list_auto_approve_categories():
                if category in seen:
                    continue
                categories.append(category)
                seen.add(category)
        return categories

    def resolve_module(self, tool_name: str) -> ToolCallModule | None:
        matched_prefixes = [
            prefix
            for prefix in self._modules_by_prefix
            if tool_name.startswith(prefix)
        ]
        if not matched_prefixes:
            return None
        prefix = max(matched_prefixes, key=len)
        return self._modules_by_prefix[prefix]

    def build_offer(self, ctx: ToolModuleContext) -> ToolOffer:
        specs_by_name: dict[str, ToolSpec] = {}
        auto_categories: dict[str, AutoApproveCategory] = {}

        for module in self.list_modules():
            module_categories = set(module.list_auto_approve_categories())
            for spec in module.list_tools(ctx):
                if not spec.name.startswith(module.prefix):
                    raise ValueError(f"Tool {spec.name} does not match module prefix {module.prefix}")
                if spec.name in specs_by_name:
                    raise ValueError(f"Duplicate tool registration in offer: {spec.name}")
                if spec.auto_approve_category is not None and spec.auto_approve_category not in module_categories:
                    raise ValueError(
                        f"Tool {spec.name} auto-approve category {spec.auto_approve_category} "
                        f"is not declared by module {module.__class__.__name__}"
                    )
                specs_by_name[spec.name] = spec
                if spec.auto_approve_category is not None:
                    auto_categories[spec.name] = spec.auto_approve_category

        provider_tools = [
            {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.parameters,
            }
            for spec in specs_by_name.values()
        ]

        return ToolOffer(
            specs_by_name=specs_by_name,
            provider_tools=provider_tools,
            auto_approve_category_by_name=auto_categories,
        )

    def list_static_tool_names(self, ctx: ToolModuleContext) -> list[str]:
        out: list[str] = []
        for module in self.list_modules():
            if getattr(module, "dynamic", False):
                continue
            out.extend(spec.name for spec in module.list_tools(ctx))
        return sorted(set(out))

    def get_auto_approve_category(self, tool_name: str, offer: ToolOffer) -> AutoApproveCategory | None:
        return offer.auto_approve_category_by_name.get(tool_name)


def registered_module_factories() -> list[ToolModuleFactory]:
    return list(_REGISTERED_MODULE_FACTORIES)

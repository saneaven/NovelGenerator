from __future__ import annotations

from .contexts import ToolModuleContext
from .contracts import (
    AutoApproveCategory,
    ToolCallModule,
    ToolFeatureModule,
    ToolFeatureModuleFactory,
    ToolModuleFactory,
    ToolOffer,
    ToolSpec,
)


_REGISTERED_MODULE_FACTORIES: list[ToolModuleFactory] = []
_REGISTERED_FEATURE_MODULE_FACTORIES: list[ToolFeatureModuleFactory] = []


def tool_call_module(*, prefix: str):
    def _decorate(cls: type[ToolCallModule]) -> type[ToolCallModule]:
        cls.prefix = prefix
        _REGISTERED_MODULE_FACTORIES.append(cls)
        return cls

    return _decorate


def tool_feature_module():
    def _decorate(cls: type[ToolFeatureModule]) -> type[ToolFeatureModule]:
        _REGISTERED_FEATURE_MODULE_FACTORIES.append(cls)
        return cls

    return _decorate


class ToolRegistry:
    def __init__(self) -> None:
        self._modules_by_feature_key: dict[str, ToolFeatureModule] = {}

    def register_module(self, module: ToolFeatureModule) -> None:
        feature_key = str(getattr(module, "feature_key", "") or "")
        if not feature_key:
            raise ValueError(f"Tool feature module {module.__class__.__name__} missing feature_key")
        if feature_key in self._modules_by_feature_key:
            raise ValueError(f"Duplicate tool feature module: {feature_key}")
        self._modules_by_feature_key[feature_key] = module

    def list_modules(self) -> list[ToolFeatureModule]:
        return [self._modules_by_feature_key[key] for key in self._modules_by_feature_key]

    def get_feature_module(self, feature_key: str) -> ToolFeatureModule:
        module = self._modules_by_feature_key.get(feature_key)
        if module is None:
            raise KeyError(f"Unknown tool feature module: {feature_key}")
        return module

    def build_offer(self, ctx: ToolModuleContext) -> ToolOffer:
        specs_by_name: dict[str, ToolSpec] = {}
        bindings_by_name = {}

        for module in self.list_modules():
            for binding in module.list_bindings(ctx):
                spec = binding.spec
                if spec.name in specs_by_name:
                    raise ValueError(f"Duplicate tool registration in offer: {spec.name}")
                specs_by_name[spec.name] = spec
                bindings_by_name[spec.name] = binding

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
            bindings_by_name=bindings_by_name,
            provider_tools=provider_tools,
        )


def registered_module_factories() -> list[ToolModuleFactory]:
    return list(_REGISTERED_MODULE_FACTORIES)


def registered_feature_module_factories() -> list[ToolFeatureModuleFactory]:
    return list(_REGISTERED_FEATURE_MODULE_FACTORIES)

from __future__ import annotations

import importlib
from typing import Any

from .contracts import ProviderSpec


_PROVIDERS: dict[str, ProviderSpec] = {}
_RUNTIME_MODULES: dict[str, Any] = {}
_LOADED = False

_BUILTINS = ("openai", "nanogpt", "gemini", "claude", "openrouter", "xai", "novelai", "custom")


def register_provider_spec(spec: ProviderSpec) -> None:
    if spec.id in _PROVIDERS:
        raise RuntimeError(f"Duplicate provider spec '{spec.id}'")
    _PROVIDERS[spec.id] = spec


def load_builtin_plugins() -> None:
    global _LOADED
    if _LOADED:
        return
    for provider_id in _BUILTINS:
        runtime_module = importlib.import_module(f"App.backend.provider_engine.provider_plugins.{provider_id}.runtime")
        module = importlib.import_module(f"App.backend.provider_engine.provider_plugins.{provider_id}.spec")
        _RUNTIME_MODULES[provider_id] = runtime_module
        register_provider_spec(module.SPEC)
    _LOADED = True


def require_provider(provider_id: str) -> ProviderSpec:
    load_builtin_plugins()
    spec = _PROVIDERS.get(str(provider_id or "").strip())
    if spec is None:
        available = ", ".join(sorted(_PROVIDERS))
        raise ValueError(f"Unknown provider '{provider_id}'. Available: {available}")
    return spec


def list_providers() -> list[ProviderSpec]:
    load_builtin_plugins()
    return list(_PROVIDERS.values())


def require_runtime_module(provider_id: str) -> Any:
    load_builtin_plugins()
    module = _RUNTIME_MODULES.get(str(provider_id or "").strip())
    if module is None:
        raise ValueError(f"Unknown provider runtime '{provider_id}'")
    return module

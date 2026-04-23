from __future__ import annotations

import importlib
from typing import Any

from .contracts import ProviderSpec


_PROVIDERS: dict[str, ProviderSpec] = {}
_MODULES: dict[tuple[str, str], Any] = {}
_LOADED = False

_BUILTINS = ("openai", "nanogpt", "gemini", "claude", "openrouter", "xai", "novelai", "custom")


def _register_provider_spec(spec: ProviderSpec) -> None:
    if spec.id in _PROVIDERS:
        raise RuntimeError(f"Duplicate provider spec '{spec.id}'")
    _PROVIDERS[spec.id] = spec


def load_builtin_providers() -> None:
    global _LOADED
    if _LOADED:
        return
    for provider_id in _BUILTINS:
        module = importlib.import_module(f"App.backend.providers.{provider_id}.spec")
        _register_provider_spec(module.SPEC)
    _LOADED = True


def require_spec(provider_id: str) -> ProviderSpec:
    load_builtin_providers()
    normalized = str(provider_id or "").strip()
    spec = _PROVIDERS.get(normalized)
    if spec is None:
        available = ", ".join(sorted(_PROVIDERS))
        raise ValueError(f"Unknown provider '{provider_id}'. Available: {available}")
    return spec


def list_specs() -> list[ProviderSpec]:
    load_builtin_providers()
    return list(_PROVIDERS.values())


def require_provider_module(provider_id: str, module_name: str) -> Any:
    load_builtin_providers()
    normalized = str(provider_id or "").strip()
    key = (normalized, module_name)
    cached = _MODULES.get(key)
    if cached is not None:
        return cached
    try:
        module = importlib.import_module(f"App.backend.providers.{normalized}.{module_name}")
    except ModuleNotFoundError as exc:
        raise ValueError(f"Provider '{provider_id}' does not support {module_name}") from exc
    _MODULES[key] = module
    return module

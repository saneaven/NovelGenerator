from __future__ import annotations

from copy import deepcopy
from typing import Any

from .shared.conditions import get_path
from .shared.contracts import DerivedFlag, LLMSpec, ProviderSpec
from .shared.normalize import merge_specs, normalize_by_spec
from .shared.registry import list_specs as _list_specs
from .shared.registry import require_provider_module, require_spec as _require_spec


def _resolve_flags(data: dict[str, Any], derived_flags: tuple[DerivedFlag, ...]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for flag in derived_flags:
        value = get_path(data, flag.source_path)
        if flag.resolver == "presence":
            out[flag.name] = value is not None
        elif flag.resolver == "bool":
            out[flag.name] = bool(value)
        else:
            import re

            out[flag.name] = isinstance(value, str) and re.search(flag.pattern or "", value) is not None
    return out


def _resolve_llm_variant_spec(spec: LLMSpec, data: dict[str, Any] | None = None, variant_hint: str | None = None):
    variant_id = variant_hint
    if variant_id is None and spec.variant_path and isinstance(data, dict):
        variant_id = get_path(data, spec.variant_path)
    resolved_key = str(variant_id or spec.default_variant or "").strip() or spec.default_variant
    if not resolved_key or resolved_key not in spec.variants:
        resolved_key = spec.default_variant or next(iter(spec.variants))
    return spec.variants[resolved_key]


def list_specs() -> list[ProviderSpec]:
    return _list_specs()


def require_spec(provider_id: str) -> ProviderSpec:
    return _require_spec(provider_id)


def normalize_credentials(provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
    provider = require_spec(provider_id)
    return normalize_by_spec(config, provider.credentials)


def normalize_task_config(provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
    provider = require_spec(provider_id)
    if provider.llm is None:
        raise ValueError(f"Provider '{provider_id}' does not support llm")
    variant = _resolve_llm_variant_spec(provider.llm, data=config)
    merged = merge_specs(provider.llm.common_task_config, variant.task_config)
    return normalize_by_spec(config, merged, flags=_resolve_flags(config, provider.llm.derived_flags))


def normalize_embedding_config(provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
    provider = require_spec(provider_id)
    if provider.embedding is None:
        raise ValueError(f"Provider '{provider_id}' does not support embedding")
    return normalize_by_spec(config, provider.embedding.config)


def prepare_provider_config(
    provider_id: str,
    provider_config: dict[str, Any] | None,
    *,
    capability: str,
    task_config: dict[str, Any] | None = None,
    variant_hint: str | None = None,
) -> dict[str, Any]:
    provider = require_spec(provider_id)
    prepared = deepcopy(provider_config) if isinstance(provider_config, dict) else {}

    runtime_spec: Any = None
    module_name = ""
    if capability in {"llm", "llm_models"}:
        if provider.llm is None:
            raise ValueError(f"Provider '{provider_id}' does not support llm")
        runtime_spec = _resolve_llm_variant_spec(provider.llm, data=task_config, variant_hint=variant_hint).runtime
        module_name = "llm"
    elif capability in {"embedding", "embedding_models"}:
        if provider.embedding is None:
            raise ValueError(f"Provider '{provider_id}' does not support embedding")
        runtime_spec = provider.embedding.runtime
        module_name = "embedding"
    elif capability in {"image", "image_models", "image_geometry"}:
        if provider.image is None:
            raise ValueError(f"Provider '{provider_id}' does not support image")
        runtime_spec = provider.image.runtime
        module_name = "image"
    else:
        raise ValueError(f"Unknown provider capability '{capability}'")

    module = require_provider_module(provider_id, module_name)
    prepare = getattr(module, "prepare_config", None)
    if callable(prepare):
        prepared = prepare(
            provider_config=prepared,
            runtime_spec=runtime_spec,
            purpose=capability,
            variant_hint=variant_hint,
        )
    return prepared


def create_llm_provider(
    provider_id: str,
    provider_config: dict[str, Any],
    *,
    task_config: dict[str, Any] | None = None,
    variant_hint: str | None = None,
):
    provider = require_spec(provider_id)
    if provider.llm is None:
        raise ValueError(f"Provider '{provider_id}' does not support llm")
    variant = _resolve_llm_variant_spec(provider.llm, data=task_config, variant_hint=variant_hint)
    module = require_provider_module(provider_id, "llm")
    config = prepare_provider_config(
        provider_id,
        provider_config,
        capability="llm",
        task_config=task_config,
        variant_hint=variant_hint,
    )
    return module.create_provider(
        provider_config=deepcopy(config),
        runtime_spec=variant.runtime,
    )


async def list_llm_models(
    provider_id: str,
    provider_config: dict[str, Any] | None,
    *,
    variant_hint: str | None = None,
) -> dict[str, Any]:
    config = prepare_provider_config(
        provider_id,
        provider_config,
        capability="llm_models",
        variant_hint=variant_hint,
    )
    provider = create_llm_provider(provider_id, config, variant_hint=variant_hint)
    try:
        if not provider.validate_config():
            raise ValueError(f"Invalid configuration for provider '{provider_id}'")
        return await provider.get_models()
    finally:
        await provider.aclose()


async def list_embedding_models(provider_id: str, provider_config: dict[str, Any] | None) -> dict[str, Any]:
    provider = require_spec(provider_id)
    if provider.embedding is None:
        raise ValueError(f"Provider '{provider_id}' does not support embedding")
    module = require_provider_module(provider_id, "embedding")
    config = prepare_provider_config(provider_id, provider_config, capability="embedding_models")
    return await module.list_models(
        provider_config=deepcopy(config),
        runtime_spec=provider.embedding.runtime,
    )


async def embed_many(
    provider_id: str,
    *,
    provider_config: dict[str, Any] | None,
    model: str,
    inputs: list[str],
    dimensions: int | None = None,
    purpose: str,
    timeout_s: float = 60.0,
) -> list[list[float]]:
    provider = require_spec(provider_id)
    if provider.embedding is None:
        raise ValueError(f"Provider '{provider_id}' does not support embedding")
    module = require_provider_module(provider_id, "embedding")
    config = prepare_provider_config(provider_id, provider_config, capability="embedding")
    return await module.embed_many(
        provider_config=deepcopy(config),
        model=model,
        inputs=inputs,
        dimensions=dimensions,
        purpose=purpose,
        timeout_s=timeout_s,
        runtime_spec=provider.embedding.runtime,
    )


def sanitize_image_settings(provider_id: str, settings: Any) -> dict[str, Any] | None:
    provider = require_spec(provider_id)
    image = provider.image
    if image is None or image.provider_settings is None:
        return None
    raw = settings if isinstance(settings, dict) else {}
    normalized = normalize_by_spec(raw, image.provider_settings)
    return normalized or None


def create_image_adapter(provider_id: str, provider_config: dict[str, Any] | None):
    provider = require_spec(provider_id)
    if provider.image is None:
        raise ValueError(f"Provider '{provider_id}' does not support image")
    module = require_provider_module(provider_id, "image")
    config = prepare_provider_config(provider_id, provider_config, capability="image")
    return module.create_adapter(
        provider_config=deepcopy(config),
        runtime_spec=provider.image.runtime,
    )


async def resolve_image_geometry(
    provider_id: str,
    *,
    provider_config: dict[str, Any] | None,
    descriptor: Any,
    requested_aspect_ratio: str,
    requested_image_size: str,
    resolved_geometry: Any,
):
    provider = require_spec(provider_id)
    if provider.image is None:
        raise ValueError(f"Provider '{provider_id}' does not support image")
    module = require_provider_module(provider_id, "image")
    resolver = getattr(module, "resolve_geometry", None)
    if resolver is None:
        return resolved_geometry
    config = prepare_provider_config(provider_id, provider_config, capability="image_geometry")
    return await resolver(
        provider_config=deepcopy(config),
        runtime_spec=provider.image.runtime,
        descriptor=descriptor,
        requested_aspect_ratio=requested_aspect_ratio,
        requested_image_size=requested_image_size,
        resolved_geometry=resolved_geometry,
    )


async def list_image_models(provider_id: str, provider_config: dict[str, Any] | None) -> list[Any]:
    provider = require_spec(provider_id)
    image = provider.image
    if image is None:
        raise ValueError(f"Provider '{provider_id}' does not support image")
    if image.models_adapter:
        module = require_provider_module(provider_id, "image")
        config = prepare_provider_config(provider_id, provider_config, capability="image_models")
        return await module.list_models(
            provider_config=deepcopy(config),
            runtime_spec=image.runtime,
            models_adapter=image.models_adapter,
        )
    return list(image.models)

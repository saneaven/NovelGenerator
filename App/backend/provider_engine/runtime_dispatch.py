from __future__ import annotations

from copy import deepcopy
from typing import Any

from .conditions import get_path
from .contracts import DerivedFlag, LLMSpec
from .normalize import merge_specs, normalize_by_spec
from .registry import (
    require_provider,
    require_runtime_module,
)


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


def normalize_task_config(provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
    provider = require_provider(provider_id)
    if provider.llm is None:
        raise ValueError(f"Provider '{provider_id}' does not support llm")
    variant = _resolve_llm_variant_spec(provider.llm, data=config)
    merged = merge_specs(provider.llm.common_task_config, variant.task_config)
    return normalize_by_spec(config, merged, flags=_resolve_flags(config, provider.llm.derived_flags))


def normalize_credentials(provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
    provider = require_provider(provider_id)
    return normalize_by_spec(config, provider.credentials)


def normalize_embedding_config(provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
    provider = require_provider(provider_id)
    if provider.embedding is None:
        raise ValueError(f"Provider '{provider_id}' does not support embedding")
    return normalize_by_spec(config, provider.embedding.config)


def create_llm_provider_instance(
    provider_id: str,
    provider_config: dict[str, Any],
    *,
    task_config: dict[str, Any] | None = None,
    variant_hint: str | None = None,
):
    provider = require_provider(provider_id)
    if provider.llm is None:
        raise ValueError(f"Provider '{provider_id}' does not support llm")
    variant = _resolve_llm_variant_spec(provider.llm, data=task_config, variant_hint=variant_hint)
    runtime_module = require_runtime_module(provider_id)
    return runtime_module.create_llm_runtime(
        provider_config=deepcopy(provider_config),
        runtime_spec=variant.runtime,
    )


async def list_embedding_models(provider_id: str, provider_config: dict[str, Any]) -> dict[str, Any]:
    provider = require_provider(provider_id)
    if provider.embedding is None:
        raise ValueError(f"Provider '{provider_id}' does not support embedding")
    runtime_module = require_runtime_module(provider_id)
    return await runtime_module.list_embedding_models(
        provider_config=deepcopy(provider_config),
        runtime_spec=provider.embedding.runtime,
    )


async def embed_many(
    provider_id: str,
    *,
    provider_config: dict[str, Any],
    model: str,
    inputs: list[str],
    dimensions: int | None = None,
    purpose: str,
    timeout_s: float = 60.0,
) -> list[list[float]]:
    provider = require_provider(provider_id)
    if provider.embedding is None:
        raise ValueError(f"Provider '{provider_id}' does not support embedding")
    runtime_module = require_runtime_module(provider_id)
    return await runtime_module.embed_many(
        provider_config=deepcopy(provider_config),
        model=model,
        inputs=inputs,
        dimensions=dimensions,
        purpose=purpose,
        timeout_s=timeout_s,
        runtime_spec=provider.embedding.runtime,
    )


def sanitize_provider_settings(provider_id: str, settings: Any) -> dict[str, Any] | None:
    provider = require_provider(provider_id)
    image = provider.image
    if image is None or image.provider_settings is None:
        return None
    raw = settings if isinstance(settings, dict) else {}
    normalized = normalize_by_spec(raw, image.provider_settings)
    return normalized or None


def create_image_adapter(provider_id: str, provider_config: dict[str, Any]):
    provider = require_provider(provider_id)
    if provider.image is None:
        raise ValueError(f"Provider '{provider_id}' does not support image")
    runtime_module = require_runtime_module(provider_id)
    return runtime_module.create_image_adapter(
        provider_config=deepcopy(provider_config),
        runtime_spec=provider.image.runtime,
    )


async def resolve_image_geometry(
    provider_id: str,
    *,
    provider_config: dict[str, Any],
    descriptor: Any,
    requested_aspect_ratio: str,
    requested_image_size: str,
    resolved_geometry: Any,
):
    provider = require_provider(provider_id)
    if provider.image is None:
        raise ValueError(f"Provider '{provider_id}' does not support image")
    runtime_module = require_runtime_module(provider_id)
    resolver = getattr(runtime_module, "resolve_image_geometry", None)
    if resolver is None:
        return resolved_geometry
    return await resolver(
        provider_config=deepcopy(provider_config),
        runtime_spec=provider.image.runtime,
        descriptor=descriptor,
        requested_aspect_ratio=requested_aspect_ratio,
        requested_image_size=requested_image_size,
        resolved_geometry=resolved_geometry,
    )


async def list_image_models(provider_id: str, provider_config: dict[str, Any]) -> list[Any]:
    provider = require_provider(provider_id)
    image = provider.image
    if image is None:
        raise ValueError(f"Provider '{provider_id}' does not support image")
    if image.models_adapter:
        runtime_module = require_runtime_module(provider_id)
        return await runtime_module.list_image_models(
            provider_config=deepcopy(provider_config),
            runtime_spec=image.runtime,
            models_adapter=image.models_adapter,
        )
    return list(image.models)

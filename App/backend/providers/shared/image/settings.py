from __future__ import annotations

from copy import deepcopy
from typing import Any

from ..contracts import MISSING, ObjectSpec
from ...registry import list_specs, require_spec
from ...registry import sanitize_image_settings
from ....schemas.settings import ImageGenConfig


def defaults_from_object_spec(spec: ObjectSpec | None) -> dict[str, Any]:
    if spec is None:
        return {}
    out: dict[str, Any] = {}
    for key, node in spec.fields.items():
        if isinstance(node, ObjectSpec):
            child = defaults_from_object_spec(node)
            if child:
                out[key] = child
            continue
        if node.default is not MISSING:
            out[key] = deepcopy(node.default)
    return out


def _list_image_providers():
    providers = [provider for provider in list_specs() if provider.image is not None]
    providers.sort(
        key=lambda spec: (
            spec.ui.image_order if spec.ui.image_order is not None else 999,
            spec.id,
        )
    )
    return providers


def default_image_gen_config() -> dict[str, Any]:
    image_providers = _list_image_providers()
    if not image_providers:
        raise ValueError("No image providers are registered")
    default_provider = image_providers[0]
    image_spec = default_provider.image
    if image_spec is None:
        raise ValueError(f"Provider '{default_provider.id}' does not support image")
    if not image_spec.models:
        raise ValueError(f"Provider '{default_provider.id}' does not define a default image model")
    default_model = image_spec.models[0]
    provider_settings = {
        provider.id: defaults_from_object_spec(provider.image.provider_settings)
        for provider in image_providers
        if provider.image is not None
    }
    return {
        "provider": default_provider.id,
        "model": default_model.id,
        "aspect_ratio": default_model.geometry.default_aspect_ratio,
        "image_size": default_model.geometry.default_resolution,
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "providerSettings": provider_settings,
    }


def validate_image_gen_config(raw: Any) -> dict[str, Any]:
    if raw is None:
        return default_image_gen_config()
    config = ImageGenConfig.model_validate(raw)
    provider_spec = require_spec(config.provider)
    if provider_spec.image is None:
        raise ValueError(f"Provider '{config.provider}' does not support image")

    normalized = config.model_dump()
    normalized_provider_settings: dict[str, dict[str, Any]] = {}
    for provider in _list_image_providers():
        stored = (
            config.providerSettings.get(provider.id)
            if isinstance(config.providerSettings, dict)
            else None
        )
        cleaned = sanitize_image_settings(provider.id, stored or {})
        normalized_provider_settings[provider.id] = cleaned or {}
    normalized["providerSettings"] = normalized_provider_settings
    return normalized

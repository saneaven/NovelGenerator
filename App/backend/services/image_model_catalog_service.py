from __future__ import annotations

from copy import deepcopy
from typing import Any, Optional

from ..provider_engine.contracts import ImageModelDescriptor, ImageModelGeometrySpec, MISSING, ObjectSpec, ResolvedImageGeometry
from ..provider_engine.registry import list_providers, require_provider
from ..provider_engine.runtime_dispatch import list_image_models as _list_image_models
from ..provider_engine.runtime_dispatch import sanitize_provider_settings


def _defaults_from_object_spec(spec: ObjectSpec | None) -> dict[str, Any]:
    if spec is None:
        return {}
    out: dict[str, Any] = {}
    for key, node in spec.fields.items():
        if isinstance(node, ObjectSpec):
            child = _defaults_from_object_spec(node)
            if child:
                out[key] = child
            continue
        if node.default is not MISSING:
            out[key] = deepcopy(node.default)
    return out


def _normalize_ratio_text(raw: Any, *, fallback: str = "1:1") -> str:
    text = str(raw or "").strip()
    if not text:
        return fallback
    for sep in (":", "/", "x"):
        if sep not in text:
            continue
        left, right = text.split(sep, 1)
        try:
            width = int(float(left.strip()))
            height = int(float(right.strip()))
        except ValueError:
            return fallback
        if width <= 0 or height <= 0:
            return fallback
        divisor = _gcd(width, height)
        return f"{width // divisor}:{height // divisor}"
    return fallback


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a or 1


def _ratio_value(raw: str) -> float:
    normalized = _normalize_ratio_text(raw)
    left, right = normalized.split(":")
    return int(left) / int(right)


def _ratio_score(candidate: str, requested: str) -> float:
    return abs(_ratio_value(candidate) - _ratio_value(requested))


def _pick_ratio(candidates: list[str], requested: str, *, fallback: str) -> str:
    if not candidates:
        return fallback
    normalized_requested = _normalize_ratio_text(requested, fallback=fallback)
    if normalized_requested in candidates:
        return normalized_requested
    return min(candidates, key=lambda candidate: _ratio_score(candidate, normalized_requested))


def sanitize_generation_settings(provider: str, settings: Any) -> dict[str, Any] | None:
    return sanitize_provider_settings(provider, settings)


def _descriptor_to_api_dict(model: ImageModelDescriptor) -> dict[str, Any]:
    return {
        "id": model.id,
        "name": model.name,
        "description": model.description,
        "canonical_slug": model.canonical_slug,
        "prompt_type": model.prompt_type,
        "supports_image_input": model.supports_image_input,
        "supported_aspect_ratios": list(model.geometry.supported_aspect_ratios),
        "supported_image_sizes": list(model.geometry.supported_resolutions),
        "default_aspect_ratio": model.geometry.default_aspect_ratio,
        "default_image_size": model.geometry.default_resolution,
        "ui_resolution_mode": model.geometry.resolution_mode,
        "architecture": model.architecture,
        "pricing": model.pricing,
    }


def default_image_gen_config() -> dict[str, Any]:
    openai_image = require_provider("openai").image
    openai_model = openai_image.models[0]
    provider_settings: dict[str, dict[str, Any]] = {}
    for provider in list_providers():
        if provider.image is None:
            continue
        provider_settings[provider.id] = _defaults_from_object_spec(provider.image.provider_settings)
    return {
        "provider": "openai",
        "model": openai_model.id,
        "aspect_ratio": openai_model.geometry.default_aspect_ratio,
        "image_size": openai_model.geometry.default_resolution,
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "providerSettings": provider_settings,
    }


def migrate_image_gen_config(raw: Any) -> dict[str, Any]:
    defaults = default_image_gen_config()
    if not isinstance(raw, dict):
        return defaults

    provider = str(raw.get("provider") or defaults["provider"]).strip() or defaults["provider"]
    model = str(raw.get("model") or defaults["model"]).strip() or defaults["model"]

    if isinstance(raw.get("aspect_ratio"), str) and raw.get("aspect_ratio"):
        aspect_ratio = _normalize_ratio_text(raw.get("aspect_ratio"), fallback=defaults["aspect_ratio"])
    elif isinstance(raw.get("size"), str) and raw.get("size"):
        aspect_ratio = _normalize_ratio_text(raw.get("size"), fallback=defaults["aspect_ratio"])
    elif isinstance(raw.get("geminiSettings"), dict):
        aspect_ratio = _normalize_ratio_text(raw["geminiSettings"].get("aspect_ratio"), fallback=defaults["aspect_ratio"])
    else:
        aspect_ratio = defaults["aspect_ratio"]

    if isinstance(raw.get("image_size"), str) and raw.get("image_size"):
        image_size = str(raw.get("image_size")).strip()
    elif isinstance(raw.get("geminiSettings"), dict) and raw["geminiSettings"].get("image_resolution"):
        image_size = str(raw["geminiSettings"]["image_resolution"]).strip()
    else:
        image_size = defaults["image_size"]

    raw_provider_settings = raw.get("providerSettings") if isinstance(raw.get("providerSettings"), dict) else {}
    provider_settings = deepcopy(defaults["providerSettings"])
    for provider_id, value in raw_provider_settings.items():
        if not isinstance(provider_id, str) or not isinstance(value, dict):
            continue
        provider_settings[provider_id] = provider_settings.get(provider_id, {}) | value
    if isinstance(raw.get("openaiSettings"), dict):
        provider_settings["openai"] = provider_settings.get("openai", {}) | raw["openaiSettings"]
    if isinstance(raw.get("novelaiSettings"), dict):
        provider_settings["novelai"] = provider_settings.get("novelai", {}) | raw["novelaiSettings"]

    normalized_provider_settings: dict[str, dict[str, Any]] = {}
    for provider_id, value in provider_settings.items():
        if not isinstance(value, dict):
            continue
        try:
            normalized = sanitize_provider_settings(provider_id, value)
        except ValueError:
            normalized_provider_settings[provider_id] = value
            continue
        normalized_provider_settings[provider_id] = normalized or {}

    migrated = {
        "provider": provider,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "image_size": image_size,
        "naturalStyles": raw.get("naturalStyles") if isinstance(raw.get("naturalStyles"), list) else [],
        "tagBasedStyles": raw.get("tagBasedStyles") if isinstance(raw.get("tagBasedStyles"), list) else [],
        "selectedNaturalStyleId": raw.get("selectedNaturalStyleId"),
        "selectedTagBasedStyleId": raw.get("selectedTagBasedStyleId"),
        "providerSettings": normalized_provider_settings,
    }
    return migrated


def rewrite_image_run_recipe(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}

    provider = str(raw.get("provider") or "").strip()
    if isinstance(raw.get("requested_aspect_ratio"), str) and raw.get("requested_aspect_ratio"):
        requested_aspect_ratio = _normalize_ratio_text(raw.get("requested_aspect_ratio"))
    elif isinstance(raw.get("requested_ratio"), str) and raw.get("requested_ratio"):
        requested_aspect_ratio = _normalize_ratio_text(raw.get("requested_ratio"))
    elif isinstance(raw.get("aspect_ratio"), str) and raw.get("aspect_ratio"):
        requested_aspect_ratio = _normalize_ratio_text(raw.get("aspect_ratio"))
    else:
        requested_aspect_ratio = "1:1"

    requested_image_size = str(raw.get("requested_image_size") or "").strip()
    if not requested_image_size:
        provider_settings = raw.get("provider_settings") if isinstance(raw.get("provider_settings"), dict) else {}
        if isinstance(provider_settings.get("image_size"), str) and provider_settings.get("image_size"):
            requested_image_size = str(provider_settings["image_size"]).strip()
        elif isinstance(provider_settings.get("image_resolution"), str) and provider_settings.get("image_resolution"):
            requested_image_size = str(provider_settings["image_resolution"]).strip()
        else:
            requested_image_size = "1K"

    return {
        "prompt_type": raw.get("prompt_type"),
        "provider": provider,
        "model": str(raw.get("model") or "").strip(),
        "requested_aspect_ratio": requested_aspect_ratio,
        "requested_image_size": requested_image_size,
        "prompt": raw.get("prompt"),
        "positive_prompt": raw.get("positive_prompt"),
        "negative_prompt": raw.get("negative_prompt"),
        "provider_settings": sanitize_generation_settings(provider, raw.get("provider_settings")),
        "reference_images": raw.get("reference_images") if isinstance(raw.get("reference_images"), list) else None,
        "reference_objects": raw.get("reference_objects") if isinstance(raw.get("reference_objects"), list) else None,
    }


class ImageModelCatalogService:
    async def list_models(self, provider: str, provider_config: dict[str, Any]) -> list[dict[str, Any]]:
        descriptors = await _list_image_models(provider, provider_config)
        return [_descriptor_to_api_dict(item) for item in descriptors]

    async def resolve_geometry(
        self,
        *,
        provider: str,
        model: str,
        requested_aspect_ratio: str,
        requested_image_size: str,
        provider_config: dict[str, Any] | None = None,
    ) -> ResolvedImageGeometry:
        descriptor = await self._find_descriptor(provider=provider, model=model, provider_config=provider_config or {})
        if descriptor is None:
            raise ValueError(f"Unknown image provider '{provider}'")

        geometry = descriptor.geometry
        resolved_ratio = _pick_ratio(
            list(geometry.supported_aspect_ratios),
            requested_aspect_ratio or geometry.default_aspect_ratio,
            fallback=geometry.default_aspect_ratio,
        )
        supported_sizes = list(geometry.supported_resolutions)
        resolved_image_size = str(requested_image_size or geometry.default_resolution).strip() or geometry.default_resolution
        if resolved_image_size not in supported_sizes:
            resolved_image_size = geometry.default_resolution

        if geometry.resolution_mode == "translated_fixed":
            native_size_by_ratio = geometry.native_size_by_ratio or {}
            resolved_native_size = native_size_by_ratio.get(resolved_ratio) or next(iter(native_size_by_ratio.values()), "1024x1024")
        else:
            resolved_native_size = resolved_image_size

        effective_model = descriptor.id or model
        return ResolvedImageGeometry(
            model=effective_model,
            prompt_type=descriptor.prompt_type,
            supports_image_input=descriptor.supports_image_input,
            requested_aspect_ratio=_normalize_ratio_text(requested_aspect_ratio, fallback=resolved_ratio),
            requested_image_size=str(requested_image_size or resolved_image_size).strip() or resolved_image_size,
            resolved_aspect_ratio=resolved_ratio,
            resolved_image_size=resolved_image_size,
            resolved_native_size=resolved_native_size,
        )

    async def _find_descriptor(self, *, provider: str, model: str, provider_config: dict[str, Any]) -> Optional[ImageModelDescriptor]:
        descriptors = await _list_image_models(provider, provider_config)
        if model:
            for descriptor in descriptors:
                if descriptor.id == model:
                    return descriptor
        if descriptors:
            return descriptors[0]

        provider_spec = require_provider(provider)
        image_spec = provider_spec.image
        if image_spec is None or not image_spec.models_adapter:
            return None

        fallback_ratios = tuple(image_spec.runtime.server_only.get("fallback_aspect_ratios") or ("1:1",))
        fallback_resolutions = tuple(image_spec.runtime.server_only.get("fallback_resolutions") or ("1K",))
        return ImageModelDescriptor(
            id=str(model or provider),
            name=str(model or provider),
            prompt_type=image_spec.prompt_type,
            supports_image_input=image_spec.supports_image_input,
            geometry=ImageModelGeometrySpec(
                supported_aspect_ratios=fallback_ratios,
                supported_resolutions=fallback_resolutions,
                default_aspect_ratio=fallback_ratios[0],
                default_resolution=fallback_resolutions[0],
                resolution_mode="native_tier",
            ),
            canonical_slug=str(model or provider),
        )


image_model_catalog_service = ImageModelCatalogService()

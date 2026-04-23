from __future__ import annotations

from typing import Any

from ..providers.shared.image.geometry import resolve_descriptor_geometry
from ..providers.shared.image.settings import default_image_gen_config as _default_image_gen_config
from ..providers.shared.contracts import ImageModelDescriptor, ImageModelGeometrySpec
from ..providers.registry import require_spec
from ..providers.registry import (
    list_image_models as _list_image_models,
    resolve_image_geometry as _resolve_image_geometry,
    sanitize_image_settings,
)


def sanitize_generation_settings(provider: str, settings: Any) -> dict[str, Any] | None:
    return sanitize_image_settings(provider, settings)


def _descriptor_to_api_dict(model: ImageModelDescriptor) -> dict[str, Any]:
    return {
        "id": model.id,
        "name": model.name,
        "description": model.description,
        "canonical_slug": model.canonical_slug,
        "owned_by": model.owned_by,
        "icon_url": model.icon_url,
        "tags": list(model.tags or ()),
        "category": model.category,
        "prompt_type": model.prompt_type,
        "supports_image_input": model.supports_image_input,
        "supports_mask_input": model.supports_mask_input,
        "supports_multi_image_input": model.supports_multi_image_input,
        "supported_aspect_ratios": list(model.geometry.supported_aspect_ratios),
        "supported_image_sizes": list(model.geometry.supported_resolutions),
        "default_aspect_ratio": model.geometry.default_aspect_ratio,
        "default_image_size": model.geometry.default_resolution,
        "ui_resolution_mode": model.geometry.resolution_mode,
        "supported_geometry_pairs": {
            key: list(value)
            for key, value in (model.geometry.supported_geometry_pairs or {}).items()
        } if model.geometry.supported_geometry_pairs else None,
        "architecture": model.architecture,
        "pricing": model.pricing,
        "capabilities": model.capabilities,
        "supported_parameters": model.supported_parameters,
    }


def default_image_gen_config() -> dict[str, Any]:
    return _default_image_gen_config()


class ImageModelCatalogService:
    async def list_models(self, provider: str, provider_config: dict[str, Any]) -> list[dict[str, Any]]:
        descriptors = await _list_image_models(provider, provider_config)
        return [_descriptor_to_api_dict(item) for item in descriptors]

    async def get_descriptor(
        self,
        *,
        provider: str,
        model: str,
        provider_config: dict[str, Any],
    ) -> ImageModelDescriptor | None:
        descriptors = await _list_image_models(provider, provider_config)
        if model:
            for descriptor in descriptors:
                if descriptor.id == model:
                    return descriptor
        if descriptors:
            return descriptors[0]

        provider_spec = require_spec(provider)
        image_spec = provider_spec.image
        if image_spec is None:
            raise ValueError(f"Provider '{provider}' does not support image")
        if image_spec.models:
            if model:
                for descriptor in image_spec.models:
                    if descriptor.id == model:
                        return descriptor
            return image_spec.models[0]
        if not image_spec.models_adapter:
            return None

        fallback_ratios = tuple(
            image_spec.runtime.server_only.get("fallback_aspect_ratios") or ("1:1",)
        )
        fallback_resolutions = tuple(
            image_spec.runtime.server_only.get("fallback_resolutions") or ("1K",)
        )
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

    async def resolve_geometry(
        self,
        *,
        provider: str,
        model: str,
        requested_aspect_ratio: str,
        requested_image_size: str,
        provider_config: dict[str, Any] | None = None,
    ):
        provider_config = provider_config or {}
        descriptor = await self.get_descriptor(
            provider=provider,
            model=model,
            provider_config=provider_config,
        )
        if descriptor is None:
            raise ValueError(f"Unknown image provider '{provider}'")

        resolved_geometry = resolve_descriptor_geometry(
            descriptor,
            requested_aspect_ratio=requested_aspect_ratio,
            requested_image_size=requested_image_size,
        )
        return await _resolve_image_geometry(
            provider,
            provider_config=provider_config,
            descriptor=descriptor,
            requested_aspect_ratio=requested_aspect_ratio,
            requested_image_size=requested_image_size,
            resolved_geometry=resolved_geometry,
        )


image_model_catalog_service = ImageModelCatalogService()

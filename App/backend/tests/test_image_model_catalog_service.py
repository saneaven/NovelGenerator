from __future__ import annotations

import asyncio

import pytest

from App.backend.providers.shared.image import orchestrator as image_orchestrator
from App.backend.providers.shared.image.contracts import ResolvedGeometry
from App.backend.providers.shared.image.request_validation import validate_canonical_recipe
from App.backend.providers.shared.image.settings import validate_image_gen_config
from App.backend.providers.shared.contracts import ImageModelDescriptor, ImageModelGeometrySpec
from App.backend.services.image_model_catalog_service import (
    image_model_catalog_service,
    sanitize_generation_settings,
)


def test_validate_image_gen_config_rejects_legacy_shape() -> None:
    with pytest.raises(Exception):
        validate_image_gen_config(
            {
                "provider": "gemini",
                "model": "gemini-3.1-flash-image-preview",
                "geminiSettings": {"aspect_ratio": "9:16", "image_resolution": "2K"},
            }
        )


def test_validate_canonical_recipe_rejects_legacy_geometry_aliases() -> None:
    with pytest.raises(Exception):
        validate_canonical_recipe(
            {
                "prompt_type": "natural",
                "provider": "openai",
                "model": "gpt-image-2",
                "requested_ratio": "1536x1024",
                "prompt": {"prefix": "", "content": "castle", "postfix": ""},
            }
        )


def test_sanitize_generation_settings_drops_geometry_keys_and_unknown_values() -> None:
    cleaned = sanitize_generation_settings(
        "openai",
        {
            "quality": "high",
            "size": "1024x1024",
            "aspect_ratio": "1:1",
            "image_size": "1K",
            "unknown": "drop-me",
        },
    )

    assert cleaned == {
        "quality": "high",
        "background": "auto",
        "output_format": "png",
        "output_compression": 90,
        "moderation": "auto",
    }


def test_canonical_recipe_preserves_conditional_reference_settings() -> None:
    normalized = validate_canonical_recipe({
        "prompt_type": "tag_based",
        "provider": "novelai",
        "model": "nai-diffusion-5-curated",
        "requested_aspect_ratio": "13:19",
        "requested_image_size": "832x1216",
        "positive_prompt": {"content": "1girl"},
        "reference_images": [{"asset_id": "ref", "strength": 0}],
        "provider_settings": {
            "referenceMode": "i2i",
            "strength": 0,
            "i2iNoise": 0,
        },
    })

    assert normalized["provider_settings"]["referenceMode"] == "i2i"
    assert normalized["provider_settings"]["strength"] == 0
    assert normalized["provider_settings"]["i2iNoise"] == 0


def test_prepare_image_request_preserves_zero_reference_strength(monkeypatch) -> None:
    descriptor = ImageModelDescriptor(
        id="test-image-model",
        name="Test image model",
        prompt_type="natural",
        supports_image_input=True,
        geometry=ImageModelGeometrySpec(
            supported_aspect_ratios=("1:1",),
            supported_resolutions=("1K",),
            default_aspect_ratio="1:1",
            default_resolution="1K",
            resolution_mode="translated_fixed",
            native_size_by_ratio={"1:1": "1024x1024"},
        ),
    )

    async def _get_descriptor(**_kwargs):
        return descriptor

    async def _resolve_geometry(**_kwargs):
        return ResolvedGeometry(
            requested_aspect_ratio="1:1",
            requested_image_size="1K",
            resolved_aspect_ratio="1:1",
            resolved_image_size="1K",
            resolved_native_size="1024x1024",
        )

    monkeypatch.setattr(
        image_orchestrator.credential_service,
        "get_provider_config",
        lambda *_args, **_kwargs: {},
    )
    monkeypatch.setattr(
        image_orchestrator.image_model_catalog_service,
        "get_descriptor",
        _get_descriptor,
    )
    monkeypatch.setattr(
        image_orchestrator.image_model_catalog_service,
        "resolve_geometry",
        _resolve_geometry,
    )
    monkeypatch.setattr(
        image_orchestrator,
        "_load_asset_bytes",
        lambda *_args, **_kwargs: b"png",
    )
    monkeypatch.setattr(
        image_orchestrator,
        "create_image_adapter",
        lambda *_args, **_kwargs: object(),
    )

    _, prepared, _ = asyncio.run(
        image_orchestrator.prepare_image_request(
            object(),
            user_id="user",
            project_id="project",
            raw_recipe={
                "prompt_type": "natural",
                "provider": "openai",
                "model": "test-image-model",
                "requested_aspect_ratio": "1:1",
                "requested_image_size": "1K",
                "prompt": {"content": "castle"},
                "reference_images": [{"asset_id": "ref", "strength": 0}],
            },
        )
    )

    assert prepared.reference_images[0].strength == 0


def test_resolve_geometry_translates_openai_tier_to_native_size() -> None:
    geometry = asyncio.run(
        image_model_catalog_service.resolve_geometry(
            provider="openai",
            model="gpt-image-2",
            requested_aspect_ratio="16:9",
            requested_image_size="4K",
            provider_config={},
        )
    )

    assert geometry.resolved_aspect_ratio == "16:9"
    assert geometry.resolved_image_size == "4K"
    assert geometry.resolved_native_size == "3840x2160"


def test_resolve_geometry_translates_openai_square_4k_to_native_size() -> None:
    geometry = asyncio.run(
        image_model_catalog_service.resolve_geometry(
            provider="openai",
            model="gpt-image-2",
            requested_aspect_ratio="1:1",
            requested_image_size="4K",
            provider_config={},
        )
    )

    assert geometry.resolved_aspect_ratio == "1:1"
    assert geometry.resolved_image_size == "4K"
    assert geometry.resolved_native_size == "2880x2880"


def test_resolve_geometry_translates_openai_ultrawide_4k_to_native_size() -> None:
    geometry = asyncio.run(
        image_model_catalog_service.resolve_geometry(
            provider="openai",
            model="gpt-image-2",
            requested_aspect_ratio="21:9",
            requested_image_size="4K",
            provider_config={},
        )
    )

    assert geometry.resolved_aspect_ratio == "21:9"
    assert geometry.resolved_image_size == "4K"
    assert geometry.resolved_native_size == "3808x1632"


def test_resolve_geometry_uses_openrouter_override_without_fetch() -> None:
    geometry = asyncio.run(
        image_model_catalog_service.resolve_geometry(
            provider="openrouter",
            model="google/gemini-3.1-flash-image-preview",
            requested_aspect_ratio="1:8",
            requested_image_size="512px",
            provider_config={},
        )
    )

    assert geometry.resolved_aspect_ratio == "1:8"
    assert geometry.resolved_image_size == "512px"
    assert geometry.resolved_native_size == "512px"


def test_resolve_geometry_handles_native_exact_models(monkeypatch) -> None:
    async def _fake_get_descriptor(*, provider: str, model: str, provider_config: dict) -> ImageModelDescriptor:
        del provider, provider_config
        return ImageModelDescriptor(
            id=model,
            name=model,
            prompt_type="natural",
            supports_image_input=True,
            geometry=ImageModelGeometrySpec(
                supported_aspect_ratios=("1:1", "3:2", "2:3"),
                supported_resolutions=("1024x1024", "1536x1024", "1024x1536"),
                default_aspect_ratio="1:1",
                default_resolution="1024x1024",
                resolution_mode="native_exact",
                supported_geometry_pairs={
                    "1:1": ("1024x1024",),
                    "3:2": ("1536x1024",),
                    "2:3": ("1024x1536",),
                },
            ),
        )

    monkeypatch.setattr(image_model_catalog_service, "get_descriptor", _fake_get_descriptor)

    geometry = asyncio.run(
        image_model_catalog_service.resolve_geometry(
            provider="nanogpt",
            model="flux-kontext-max",
            requested_aspect_ratio="1:1",
            requested_image_size="1536x1024",
            provider_config={},
        )
    )

    assert geometry.resolved_aspect_ratio == "3:2"
    assert geometry.resolved_image_size == "1536x1024"
    assert geometry.resolved_native_size == "1536x1024"

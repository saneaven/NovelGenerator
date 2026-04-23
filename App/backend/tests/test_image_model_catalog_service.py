from __future__ import annotations

import asyncio

from App.backend.provider_engine.contracts import ImageModelDescriptor, ImageModelGeometrySpec
from App.backend.services.image_model_catalog_service import (
    image_model_catalog_service,
    migrate_image_gen_config,
    rewrite_image_run_recipe,
    sanitize_generation_settings,
)


def test_migrate_image_gen_config_rewrites_legacy_shape() -> None:
    migrated = migrate_image_gen_config(
        {
            "provider": "gemini",
            "model": "gemini-3.1-flash-image-preview",
            "geminiSettings": {"aspect_ratio": "9:16", "image_resolution": "2K"},
        }
    )

    assert migrated["aspect_ratio"] == "9:16"
    assert migrated["image_size"] == "2K"
    assert "geminiSettings" not in migrated


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


def test_rewrite_image_run_recipe_normalizes_requested_geometry() -> None:
    rewritten = rewrite_image_run_recipe(
        {
            "prompt_type": "natural",
            "provider": "openai",
            "model": "gpt-image-1.5",
            "requested_ratio": "1536x1024",
            "provider_settings": {"quality": "high", "size": "1536x1024"},
        }
    )

    assert rewritten["model"] == "gpt-image-2"
    assert rewritten["requested_aspect_ratio"] == "3:2"
    assert rewritten["requested_image_size"] == "1K"
    assert rewritten["provider_settings"] == {
        "quality": "high",
        "background": "auto",
        "output_format": "png",
        "output_compression": 90,
        "moderation": "auto",
    }


def test_rewrite_image_run_recipe_preserves_mask_image() -> None:
    rewritten = rewrite_image_run_recipe(
        {
            "prompt_type": "natural",
            "provider": "nanogpt",
            "model": "flux-kontext-max",
            "requested_aspect_ratio": "1:1",
            "requested_image_size": "1024x1024",
            "mask_image": {"asset_id": "mask-asset-1"},
        }
    )

    assert rewritten["mask_image"] == {"asset_id": "mask-asset-1"}


def test_migrate_image_gen_config_upgrades_openai_legacy_model_and_settings() -> None:
    migrated = migrate_image_gen_config(
        {
            "provider": "openai",
            "model": "gpt-image-1.5",
            "aspect_ratio": "4:1",
            "image_size": "1536x1024",
            "providerSettings": {
                "openai": {
                    "quality": "high",
                    "background": "transparent",
                    "output_format": "png",
                    "output_compression": 90,
                    "input_fidelity": "high",
                }
            },
        }
    )

    assert migrated["model"] == "gpt-image-2"
    assert migrated["aspect_ratio"] == "21:9"
    assert migrated["image_size"] == "1K"
    assert migrated["providerSettings"]["openai"] == {
        "quality": "high",
        "background": "auto",
        "output_format": "png",
        "output_compression": 90,
        "moderation": "auto",
    }


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
    assert geometry.resolved_native_size == "4368x1872"


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
    async def _fake_find_descriptor(*, provider: str, model: str, provider_config: dict) -> ImageModelDescriptor:
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

    monkeypatch.setattr(image_model_catalog_service, "_find_descriptor", _fake_find_descriptor)

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

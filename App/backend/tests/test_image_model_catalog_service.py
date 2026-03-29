from __future__ import annotations

import asyncio

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
        "input_fidelity": "high",
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

    assert rewritten["requested_aspect_ratio"] == "3:2"
    assert rewritten["requested_image_size"] == "1K"
    assert rewritten["provider_settings"] == {
        "quality": "high",
        "background": "auto",
        "output_format": "png",
        "output_compression": 90,
        "input_fidelity": "high",
    }


def test_resolve_geometry_translates_fixed_provider_to_native_size() -> None:
    geometry = asyncio.run(
        image_model_catalog_service.resolve_geometry(
            provider="openai",
            model="gpt-image-1.5",
            requested_aspect_ratio="3:2",
            requested_image_size="4K",
            provider_config={},
        )
    )

    assert geometry.resolved_aspect_ratio == "3:2"
    assert geometry.resolved_image_size == "1K"
    assert geometry.resolved_native_size == "1536x1024"


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

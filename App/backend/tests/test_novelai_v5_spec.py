from __future__ import annotations

from App.backend.providers.novelai.spec import (
    SPEC,
    V5_SUPPORTED_SAMPLERS,
    V5_SUPPORTED_SIZES,
)


def test_novelai_v5_models_are_first_and_use_native_exact_geometry() -> None:
    assert SPEC.image is not None
    models = SPEC.image.models

    assert [model.id for model in models] == [
        "nai-diffusion-5-curated",
        "nai-diffusion-5-full",
        "nai-diffusion-4-5-full",
        "nai-diffusion-4-5-curated",
    ]

    for model in models[:2]:
        assert model.supports_image_input is True
        assert model.supports_multi_image_input is False
        assert model.supports_mask_input is False
        assert model.geometry.resolution_mode == "native_exact"
        assert model.geometry.default_aspect_ratio == "13:19"
        assert model.geometry.default_resolution == "832x1216"
        assert model.geometry.supported_resolutions == V5_SUPPORTED_SIZES
        assert len(model.geometry.supported_resolutions) == 11

    assert V5_SUPPORTED_SIZES == (
        "512x768",
        "768x512",
        "640x640",
        "832x1216",
        "1216x832",
        "1024x1024",
        "1024x1536",
        "1536x1024",
        "1472x1472",
        "1088x1920",
        "1920x1088",
    )


def test_novelai_v5_settings_use_existing_provider_settings() -> None:
    assert SPEC.image is not None
    fields = SPEC.image.provider_settings.fields

    assert set(V5_SUPPORTED_SAMPLERS).issubset(fields["sampler"].options)
    assert fields["sampler"].default == "k_euler_ancestral"
    assert fields["steps"].min_value == 1
    assert fields["steps"].max_value == 50
    assert fields["scale"].min_value == 1
    assert fields["qualityPreset"].options == ("off", "standard", "light")
    assert fields["qualityPreset"].default == "off"
    assert fields["ucPreset"].options == ("off", "heavy")
    assert fields["ucPreset"].default == "off"


def test_novelai_v45_geometry_is_unchanged() -> None:
    assert SPEC.image is not None
    assert all(
        model.geometry.resolution_mode == "translated_fixed"
        for model in SPEC.image.models[2:]
    )

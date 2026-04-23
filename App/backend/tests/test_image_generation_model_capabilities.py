from App.backend.providers.registry import require_spec


def test_openai_image_provider_lists_only_gpt_image_models() -> None:
    image_spec = require_spec("openai").image
    assert image_spec is not None
    assert [item.id for item in image_spec.models] == [
        "gpt-image-2",
    ]


def test_gemini_image_provider_lists_latest_models() -> None:
    image_spec = require_spec("gemini").image
    assert image_spec is not None
    assert [item.id for item in image_spec.models] == [
        "gemini-3.1-flash-image-preview",
        "gemini-3-pro-image-preview",
    ]


def test_gemini_flash_image_supports_extended_aspect_ratios_and_512px() -> None:
    image_spec = require_spec("gemini").image
    assert image_spec is not None
    model = next(item for item in image_spec.models if item.id == "gemini-3.1-flash-image-preview")

    assert "4:1" in model.geometry.supported_aspect_ratios
    assert "1:8" in model.geometry.supported_aspect_ratios
    assert list(model.geometry.supported_resolutions) == ["512px", "1K", "2K", "4K"]


def test_gemini_pro_image_resolution_excludes_512px() -> None:
    image_spec = require_spec("gemini").image
    assert image_spec is not None
    model = next(item for item in image_spec.models if item.id == "gemini-3-pro-image-preview")

    assert "512px" not in model.geometry.supported_resolutions
    assert list(model.geometry.supported_resolutions) == ["1K", "2K", "4K"]


def test_openai_image_supports_gpt_image_2_ratios_and_tiers() -> None:
    image_spec = require_spec("openai").image
    assert image_spec is not None
    model = image_spec.models[0]

    assert "21:9" in model.geometry.supported_aspect_ratios
    assert "1:8" not in model.geometry.supported_aspect_ratios
    assert list(model.geometry.supported_resolutions) == ["1K", "2K", "4K"]

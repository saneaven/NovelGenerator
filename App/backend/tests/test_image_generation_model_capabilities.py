from App.backend.image_providers.model_capabilities import (
    GEMINI_MODEL_OPTIONS,
    OPENAI_MODEL_OPTIONS,
    get_gemini_supported_aspect_ratios,
    get_gemini_supported_resolutions,
    get_openai_supported_aspect_ratios,
    get_openai_supported_resolutions,
)


def test_openai_image_provider_lists_only_gpt_image_models() -> None:
    assert [item["id"] for item in OPENAI_MODEL_OPTIONS] == [
        "gpt-image-2",
    ]


def test_gemini_image_provider_lists_latest_models() -> None:
    assert [item["id"] for item in GEMINI_MODEL_OPTIONS] == [
        "gemini-3.1-flash-image-preview",
        "gemini-3-pro-image-preview",
    ]


def test_gemini_flash_image_supports_extended_aspect_ratios_and_512px() -> None:
    aspect_ratios = get_gemini_supported_aspect_ratios("gemini-3.1-flash-image-preview")
    resolutions = get_gemini_supported_resolutions("gemini-3.1-flash-image-preview")

    assert "4:1" in aspect_ratios
    assert "1:8" in aspect_ratios
    assert resolutions == ["512px", "1K", "2K", "4K"]


def test_gemini_pro_image_resolution_excludes_512px() -> None:
    resolutions = get_gemini_supported_resolutions("gemini-3-pro-image-preview")

    assert "512px" not in resolutions
    assert resolutions == ["1K", "2K", "4K"]


def test_openai_image_supports_gpt_image_2_ratios_and_tiers() -> None:
    aspect_ratios = get_openai_supported_aspect_ratios("gpt-image-2")
    resolutions = get_openai_supported_resolutions("gpt-image-2")

    assert "21:9" in aspect_ratios
    assert "1:8" not in aspect_ratios
    assert resolutions == ["1K", "2K", "4K"]

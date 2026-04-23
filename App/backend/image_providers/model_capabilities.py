"""Shared image model capability metadata."""

OPENAI_DEFAULT_MODEL = "gpt-image-2"
OPENAI_MODEL_OPTIONS = [
    {"id": "gpt-image-2", "name": "GPT Image 2"},
]
OPENAI_ASPECT_RATIOS_BY_MODEL = {
    "gpt-image-2": ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
}
OPENAI_RESOLUTION_OPTIONS_BY_MODEL = {
    "gpt-image-2": ["1K", "2K", "4K"],
}

GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-image-preview"
GEMINI_MODEL_OPTIONS = [
    {"id": "gemini-3.1-flash-image-preview", "name": "Gemini 3.1 Flash Image Preview"},
    {"id": "gemini-3-pro-image-preview", "name": "Gemini 3 Pro Image Preview"},
]
GEMINI_ASPECT_RATIOS_BY_MODEL = {
    "gemini-3.1-flash-image-preview": ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1"],
    "gemini-3-pro-image-preview": ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
}
GEMINI_RESOLUTION_OPTIONS_BY_MODEL = {
    "gemini-3.1-flash-image-preview": ["512px", "1K", "2K", "4K"],
    "gemini-3-pro-image-preview": ["1K", "2K", "4K"],
}


def get_openai_supported_aspect_ratios(model: str) -> list[str]:
    return OPENAI_ASPECT_RATIOS_BY_MODEL.get(model, OPENAI_ASPECT_RATIOS_BY_MODEL[OPENAI_DEFAULT_MODEL])


def get_openai_supported_resolutions(model: str) -> list[str]:
    return OPENAI_RESOLUTION_OPTIONS_BY_MODEL.get(model, OPENAI_RESOLUTION_OPTIONS_BY_MODEL[OPENAI_DEFAULT_MODEL])


def get_gemini_supported_aspect_ratios(model: str) -> list[str]:
    return GEMINI_ASPECT_RATIOS_BY_MODEL.get(model, GEMINI_ASPECT_RATIOS_BY_MODEL[GEMINI_DEFAULT_MODEL])


def get_gemini_supported_resolutions(model: str) -> list[str]:
    return GEMINI_RESOLUTION_OPTIONS_BY_MODEL.get(model, GEMINI_RESOLUTION_OPTIONS_BY_MODEL[GEMINI_DEFAULT_MODEL])

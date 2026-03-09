"""Shared image model capability metadata."""

OPENAI_DEFAULT_MODEL = "gpt-image-1.5"
OPENAI_MODEL_OPTIONS = [
    {"id": "gpt-image-1.5", "name": "GPT Image 1.5"},
    {"id": "gpt-image-1", "name": "GPT Image 1"},
]
OPENAI_SIZE_OPTIONS_BY_MODEL = {
    "gpt-image-1.5": ["1024x1024", "1536x1024", "1024x1536"],
    "gpt-image-1": ["1024x1024", "1536x1024", "1024x1536"],
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


def get_openai_supported_sizes(model: str) -> list[str]:
    return OPENAI_SIZE_OPTIONS_BY_MODEL.get(model, OPENAI_SIZE_OPTIONS_BY_MODEL[OPENAI_DEFAULT_MODEL])


def get_gemini_supported_aspect_ratios(model: str) -> list[str]:
    return GEMINI_ASPECT_RATIOS_BY_MODEL.get(model, GEMINI_ASPECT_RATIOS_BY_MODEL[GEMINI_DEFAULT_MODEL])


def get_gemini_supported_resolutions(model: str) -> list[str]:
    return GEMINI_RESOLUTION_OPTIONS_BY_MODEL.get(model, GEMINI_RESOLUTION_OPTIONS_BY_MODEL[GEMINI_DEFAULT_MODEL])

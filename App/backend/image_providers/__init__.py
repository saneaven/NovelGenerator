"""Image provider registrations."""

from __future__ import annotations

from importlib import import_module


def _optional_import(name: str):
    try:
        return import_module(f"{__name__}.{name}")
    except ModuleNotFoundError:
        return None


gemini_image = _optional_import("gemini_image")
novelai_image = _optional_import("novelai_image")
openai_image = _optional_import("openai_image")
openrouter_image = _optional_import("openrouter_image")
xai_image = _optional_import("xai_image")

__all__ = ["gemini_image", "novelai_image", "openai_image", "openrouter_image", "xai_image"]

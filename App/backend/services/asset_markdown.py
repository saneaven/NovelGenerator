from __future__ import annotations

from typing import Any


def _flatten_styled_prompt(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    return str(data.get("content") or "").strip()


def build_markdown_image_title(asset: Any) -> str | None:
    positive = _flatten_styled_prompt(getattr(asset, "generation_positive_prompt", None))
    negative = _flatten_styled_prompt(getattr(asset, "generation_negative_prompt", None))
    natural = _flatten_styled_prompt(getattr(asset, "generation_prompt", None))

    if natural:
        return natural
    if positive or negative:
        pieces: list[str] = []
        if positive:
            pieces.append(f"POS: {positive}")
        if negative:
            pieces.append(f"NEG: {negative}")
        return " | ".join(pieces).strip() or None
    return None

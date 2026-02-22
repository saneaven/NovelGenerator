from __future__ import annotations

from typing import Any


REASONING_TYPES = {"custom", "openai", "gemini", "claude", "openrouter", "openai_compatible"}
REASONING_PROVIDERS = {"openai", "gemini", "claude", "openrouter", "custom", "xai"}


def normalize_reasoning_detail(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    reasoning_type = str(raw.get("type") or "").strip()
    if reasoning_type not in REASONING_TYPES:
        return None

    meta_raw = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
    meta: dict[str, Any] = {}

    provider = str(meta_raw.get("provider") or "").strip()
    if provider in REASONING_PROVIDERS:
        meta["provider"] = provider

    thinking_format = str(meta_raw.get("openai_compatible_thinking_format") or "").strip()
    if thinking_format:
        meta["openai_compatible_thinking_format"] = thinking_format

    custom_template_id = meta_raw.get("custom_thinking_template_id")
    if isinstance(custom_template_id, str) and custom_template_id.strip():
        meta["custom_thinking_template_id"] = custom_template_id.strip()

    openrouter_format = meta_raw.get("openrouter_reasoning_format")
    if isinstance(openrouter_format, str) and openrouter_format.strip():
        meta["openrouter_reasoning_format"] = openrouter_format

    data = raw.get("data") if isinstance(raw.get("data"), dict) else {}

    token_count_raw = raw.get("token_count")
    if isinstance(token_count_raw, bool):
        token_count_raw = int(token_count_raw)
    if isinstance(token_count_raw, (int, float)):
        token_count = int(token_count_raw)
    else:
        token_count = 0
    if token_count < 0:
        token_count = 0

    return {
        "type": reasoning_type,
        "meta": meta,
        "data": data,
        "token_count": token_count,
    }

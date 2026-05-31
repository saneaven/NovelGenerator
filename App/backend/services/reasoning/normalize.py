from __future__ import annotations

from typing import Any

from ...providers.registry import list_specs


def _reasoning_providers() -> set[str]:
    return {spec.id for spec in list_specs() if spec.llm is not None}


def normalize_reasoning_detail(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    provider_ids = _reasoning_providers()
    reasoning_type = str(raw.get("type") or "").strip()
    if reasoning_type not in provider_ids and reasoning_type != "openai_compatible_template":
        return None

    meta_raw = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
    meta: dict[str, Any] = {}

    provider = str(meta_raw.get("provider") or "").strip()
    if provider in provider_ids:
        meta["provider"] = provider

    thinking_display = meta_raw.get("thinking_display")
    if isinstance(thinking_display, str) and thinking_display.strip():
        meta["thinking_display"] = thinking_display.strip()

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

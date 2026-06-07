from __future__ import annotations

from html import unescape
import json
from typing import Any


def _normalized_json(raw: dict[str, Any]) -> str:
    return json.dumps(raw, ensure_ascii=False, separators=(",", ":"))


def _decode_argument_values(value: Any) -> Any:
    if isinstance(value, str):
        return unescape(value)
    if isinstance(value, list):
        return [_decode_argument_values(item) for item in value]
    if isinstance(value, dict):
        return {key: _decode_argument_values(item) for key, item in value.items()}
    return value


def _normalize_arguments(raw: dict[str, Any]) -> dict[str, Any]:
    return {key: _decode_argument_values(value) for key, value in raw.items()}


def parse_tool_call_arguments(raw: Any) -> tuple[str, dict[str, Any], str | None]:
    if isinstance(raw, dict):
        normalized = _normalize_arguments(raw)
        return _normalized_json(normalized), normalized, None

    if not isinstance(raw, str):
        return "{}", {}, None

    raw_text = raw.strip() or "{}"
    try:
        parsed = json.loads(raw_text)
    except Exception as exc:
        return raw_text, {}, str(exc)

    if isinstance(parsed, dict):
        normalized = _normalize_arguments(parsed)
        return _normalized_json(normalized), normalized, None

    if isinstance(parsed, str):
        inner_raw = parsed.strip() or "{}"
        try:
            inner = json.loads(inner_raw)
        except Exception as exc:
            return raw_text, {}, f"Tool arguments JSON string did not decode to an object: {exc}"
        if isinstance(inner, dict):
            normalized = _normalize_arguments(inner)
            return _normalized_json(normalized), normalized, None
        return raw_text, {}, "Tool arguments JSON string did not decode to an object"

    return raw_text, {}, "Tool arguments JSON is not an object"

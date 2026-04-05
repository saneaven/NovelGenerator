from __future__ import annotations

import json
from typing import Any


def _normalized_json(raw: dict[str, Any]) -> str:
    return json.dumps(raw, ensure_ascii=False, separators=(",", ":"))


def parse_tool_call_arguments(raw: Any) -> tuple[str, dict[str, Any], str | None]:
    if isinstance(raw, dict):
        return _normalized_json(raw), raw, None

    if not isinstance(raw, str):
        return "{}", {}, None

    raw_text = raw.strip() or "{}"
    try:
        parsed = json.loads(raw_text)
    except Exception as exc:
        return raw_text, {}, str(exc)

    if isinstance(parsed, dict):
        return _normalized_json(parsed), parsed, None

    if isinstance(parsed, str):
        inner_raw = parsed.strip() or "{}"
        try:
            inner = json.loads(inner_raw)
        except Exception as exc:
            return raw_text, {}, f"Tool arguments JSON string did not decode to an object: {exc}"
        if isinstance(inner, dict):
            return _normalized_json(inner), inner, None
        return raw_text, {}, "Tool arguments JSON string did not decode to an object"

    return raw_text, {}, "Tool arguments JSON is not an object"

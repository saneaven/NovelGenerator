from __future__ import annotations

from typing import Any

from .custom_template_runtime import get_nested_path


def _collapse_content_text(parts: Any) -> str:
    if not isinstance(parts, list):
        return ""
    return "".join(
        str(part.get("text") or "")
        for part in parts
        if isinstance(part, dict) and part.get("type") == "content"
    )


def _reasoning_display_text(reasoning_detail: Any) -> str:
    if not isinstance(reasoning_detail, dict):
        return ""
    meta = reasoning_detail.get("meta") if isinstance(reasoning_detail.get("meta"), dict) else {}
    data = reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}
    path = meta.get("thinking_display")
    if not isinstance(path, str) or not path.strip():
        return ""
    value = get_nested_path(data, path.strip())
    return value if isinstance(value, str) else ""


def apply_thinking_mode(messages: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    for message in messages:
        if message.get("role") != "assistant":
            out.append(message)
            continue

        content_text = _collapse_content_text(message.get("content_parts"))
        thinking_text = _reasoning_display_text(message.get("reasoning_detail"))

        next_message = dict(message)

        if mode == "off":
            next_message["content_parts"] = (
                [{"type": "content", "text": content_text}] if content_text else []
            )
            next_message.pop("reasoning_detail", None)
        elif mode == "custom":
            merged = f"<thinking>{thinking_text}</thinking>{content_text}" if thinking_text else content_text
            next_message["content_parts"] = (
                [{"type": "content", "text": merged}] if merged else []
            )
            next_message.pop("reasoning_detail", None)
        elif mode == "model":
            next_message["content_parts"] = (
                [{"type": "content", "text": content_text}] if content_text else []
            )
        else:
            # Unknown mode: fallback to off semantics.
            next_message["content_parts"] = (
                [{"type": "content", "text": content_text}] if content_text else []
            )
            next_message.pop("reasoning_detail", None)

        out.append(next_message)

    return out

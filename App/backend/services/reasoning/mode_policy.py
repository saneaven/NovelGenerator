from __future__ import annotations

from typing import Any


def apply_thinking_mode(messages: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    for message in messages:
        if message.get("role") != "assistant":
            out.append(message)
            continue

        parts = message.get("content_parts") if isinstance(message.get("content_parts"), list) else []
        content_text = "".join(
            str(part.get("text") or "")
            for part in parts
            if isinstance(part, dict) and part.get("type") == "content"
        )
        thinking_text = "".join(
            str(part.get("text") or "")
            for part in parts
            if isinstance(part, dict) and part.get("type") == "thinking"
        )

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

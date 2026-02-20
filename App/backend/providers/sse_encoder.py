from __future__ import annotations

import json
from typing import Any


def encode_sse(event_name: str, payload: dict[str, Any], event_id: int | None = None) -> bytes:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event_name}")
    lines.append(f"data: {body}")
    return ("\n".join(lines) + "\n\n").encode("utf-8")

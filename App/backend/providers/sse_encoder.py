from __future__ import annotations

import json
from typing import Any, Dict


def encode_sse(event_name: str, payload: Dict[str, Any]) -> bytes:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_name}\ndata: {body}\n\n".encode("utf-8")

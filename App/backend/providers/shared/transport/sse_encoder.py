from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
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


def encode_sse_comment(comment: str = "heartbeat") -> bytes:
    return f": {comment}\n\n".encode("utf-8")


def encode_sse_envelope(envelope: dict[str, Any]) -> bytes:
    event_id: int | None = None
    event: dict[str, Any]
    if isinstance(envelope, dict) and isinstance(envelope.get("event"), dict):
        event = envelope.get("event") or {}
        raw_event_id = envelope.get("event_id")
        if isinstance(raw_event_id, int):
            event_id = raw_event_id
    else:
        event = envelope if isinstance(envelope, dict) else {}

    name = str(event.get("event") or "message")
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    return encode_sse(name, data, event_id=event_id)


async def iter_sse_with_heartbeat(
    envelopes: AsyncIterator[dict[str, Any]],
    *,
    heartbeat_interval: float,
) -> AsyncIterator[bytes]:
    iterator = aiter(envelopes)
    next_item_task = asyncio.create_task(anext(iterator))

    try:
        while True:
            done, _ = await asyncio.wait({next_item_task}, timeout=heartbeat_interval)
            if next_item_task in done:
                try:
                    envelope = next_item_task.result()
                except StopAsyncIteration:
                    break
                yield encode_sse_envelope(envelope)
                next_item_task = asyncio.create_task(anext(iterator))
                continue

            yield encode_sse_comment()
    finally:
        if not next_item_task.done():
            next_item_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await next_item_task

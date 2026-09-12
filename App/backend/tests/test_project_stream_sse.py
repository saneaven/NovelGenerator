from __future__ import annotations

import asyncio

from App.backend.providers.shared.transport.sse_encoder import iter_sse_with_heartbeat


async def _idle_envelopes():
    while True:
        await asyncio.sleep(3600)
        yield {}


async def _single_envelope():
    yield {
        "event_id": 12,
        "event": {
            "event": "run:status",
            "data": {
                "thread_id": "thread-1",
                "project_id": "project-1",
                "status": "running",
            },
        },
    }


def test_project_stream_sends_heartbeat_comments_when_idle() -> None:
    async def _run() -> bytes:
        stream = iter_sse_with_heartbeat(_idle_envelopes(), heartbeat_interval=0.01)
        try:
            return await anext(stream)
        finally:
            await stream.aclose()

    payload = asyncio.run(_run()).decode("utf-8")
    assert payload == ": heartbeat\n\n"
    assert "id:" not in payload


def test_project_stream_preserves_standard_sse_event_format() -> None:
    async def _run() -> bytes:
        stream = iter_sse_with_heartbeat(_single_envelope(), heartbeat_interval=1.0)
        try:
            return await anext(stream)
        finally:
            await stream.aclose()

    payload = asyncio.run(_run()).decode("utf-8")
    assert "id: 12\n" in payload
    assert "event: run:status\n" in payload
    assert 'data: {"thread_id":"thread-1","project_id":"project-1","status":"running"}\n\n' in payload


def test_project_stream_closes_the_subscribed_envelope_iterator() -> None:
    async def _run() -> bool:
        closed = asyncio.Event()

        async def _envelopes():
            try:
                yield {
                    "event_id": 1,
                    "event": {"event": "run:status", "data": {"status": "running"}},
                }
                await asyncio.sleep(3600)
            finally:
                closed.set()

        stream = iter_sse_with_heartbeat(_envelopes(), heartbeat_interval=1.0)
        await anext(stream)
        await stream.aclose()
        return closed.is_set()

    assert asyncio.run(_run()) is True

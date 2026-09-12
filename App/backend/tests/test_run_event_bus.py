from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from typing import Any

from App.backend.services.run_event_bus import InMemoryRunEventBus


def _event(name: str, marker: str) -> dict[str, Any]:
    return {"event": name, "data": {"marker": marker}}


async def _collect(
    stream: AsyncIterator[dict[str, Any]],
    count: int,
) -> list[dict[str, Any]]:
    return [await anext(stream) for _ in range(count)]


def test_delta_history_overflow_preserves_state_events_and_global_order() -> None:
    async def _run() -> None:
        bus = InMemoryRunEventBus(max_history=64)

        await bus.publish("user:1", _event("message:start", "state-1"))
        for index in range(40):
            await bus.publish("user:1", _event("content:delta", f"delta-a-{index}"))
        await bus.publish("user:1", _event("tool_call:status", "state-2"))
        for index in range(40):
            await bus.publish("user:1", _event("thinking:delta", f"delta-b-{index}"))
        await bus.publish("user:1", _event("run:status", "state-3"))

        stream = bus.subscribe("user:1", start_from="history")
        received = await _collect(stream, 67)
        await stream.aclose()

        assert [item["event_id"] for item in received] == [1, *range(18, 84)]
        assert [
            item["event"]["data"]["marker"]
            for item in received
            if item["event"]["event"] not in {
                "content:delta",
                "thinking:delta",
                "tool_call:delta",
            }
        ] == ["state-1", "state-2", "state-3"]

    asyncio.run(_run())


def test_subscriber_delta_overflow_preserves_state_events_and_global_order() -> None:
    async def _run() -> None:
        bus = InMemoryRunEventBus(max_history=512)
        stream = bus.subscribe("user:1", start_from="latest")
        first_item = asyncio.create_task(anext(stream))
        await asyncio.sleep(0)

        await bus.publish("user:1", _event("message:start", "state-1"))
        for index in range(150):
            await bus.publish("user:1", _event("content:delta", f"delta-a-{index}"))
        await bus.publish("user:1", _event("tool_call:status", "state-2"))
        for index in range(150):
            await bus.publish("user:1", _event("tool_call:delta", f"delta-b-{index}"))
        await bus.publish("user:1", _event("message:end", "state-3"))

        received = [await first_item, *(await _collect(stream, 258))]
        await stream.aclose()

        assert [item["event_id"] for item in received] == [1, *range(46, 304)]
        assert [
            item["event"]["data"]["marker"]
            for item in received
            if item["event"]["event"] not in {
                "content:delta",
                "thinking:delta",
                "tool_call:delta",
            }
        ] == ["state-1", "state-2", "state-3"]

    asyncio.run(_run())


def test_history_survives_last_subscriber_disconnect_until_ttl_cleanup() -> None:
    async def _run() -> None:
        bus = InMemoryRunEventBus()
        first_stream = bus.subscribe("user:1", start_from="latest")
        first_item = asyncio.create_task(anext(first_stream))
        await asyncio.sleep(0)

        await bus.publish("user:1", _event("tool_call:status", "before-disconnect"))
        assert (await first_item)["event_id"] == 1
        await first_stream.aclose()

        await bus.publish("user:1", _event("run:status", "while-disconnected"))

        resumed_stream = bus.subscribe("user:1", after_event_id=0)
        replayed = await _collect(resumed_stream, 2)
        await resumed_stream.aclose()

        assert [item["event_id"] for item in replayed] == [1, 2]
        assert [item["event"]["data"]["marker"] for item in replayed] == [
            "before-disconnect",
            "while-disconnected",
        ]

    asyncio.run(_run())


def test_state_history_is_pruned_by_ttl_even_while_channel_stays_active() -> None:
    async def _run() -> None:
        bus = InMemoryRunEventBus()
        bus._ttl = timedelta(milliseconds=1)

        await bus.publish("user:1", _event("tool_call:status", "expired"))
        await asyncio.sleep(0.01)
        await bus.publish("user:1", _event("run:status", "current"))

        stream = bus.subscribe("user:1", start_from="history")
        replayed = await _collect(stream, 1)
        await stream.aclose()

        assert [item["event"]["data"]["marker"] for item in replayed] == ["current"]

    asyncio.run(_run())


def test_closing_during_backlog_replay_removes_subscriber() -> None:
    async def _run() -> None:
        bus = InMemoryRunEventBus()
        await bus.publish("user:1", _event("run:status", "backlog"))

        stream = bus.subscribe("user:1", start_from="history")
        assert (await anext(stream))["event_id"] == 1
        await stream.aclose()

        assert not bus._channels["user:1"].subscribers

    asyncio.run(_run())


def test_cleanup_cannot_orphan_a_publisher_waiting_for_the_channel_lock() -> None:
    async def _run() -> None:
        bus = InMemoryRunEventBus(ttl_seconds=60)
        await bus.publish("user:1", _event("run:status", "initial"))
        channel = bus._channels["user:1"]
        channel.updated_at = datetime.utcnow() - timedelta(minutes=2)

        await channel.lock.acquire()
        publish_task = asyncio.create_task(
            bus.publish("user:1", _event("tool_call:status", "racing"))
        )
        await asyncio.sleep(0)
        cleanup_task = asyncio.create_task(bus._cleanup_expired_channels())
        await asyncio.sleep(0)
        channel.lock.release()

        await asyncio.gather(publish_task, cleanup_task)

        assert bus._channels["user:1"] is channel
        assert [
            entry.envelope["event"]["data"]["marker"]
            for entry in channel.state_history
        ] == ["initial", "racing"]

    asyncio.run(_run())

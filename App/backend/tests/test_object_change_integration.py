from __future__ import annotations

import asyncio
from uuid import uuid4

from App.backend.services.runtime_event_dispatcher import RuntimeEventDispatcher


class FakeBus:
    def __init__(self) -> None:
        self.published: list[tuple[str, dict[str, object]]] = []

    async def publish(self, channel: str, event: dict[str, object]) -> None:
        self.published.append((channel, event))


def test_emit_project_event_publishes_only_project_channel() -> None:
    bus = FakeBus()
    dispatcher = RuntimeEventDispatcher(bus)  # type: ignore[arg-type]
    user_id = uuid4()
    project_id = uuid4()

    async def _runner() -> None:
        await dispatcher.emit_project_event(
            user_id=user_id,
            project_id=project_id,
            event_name="object:changed",
            data={"batch_id": str(uuid4()), "changes": []},
        )

    asyncio.run(_runner())

    assert len(bus.published) == 2
    channels = [channel for channel, _event in bus.published]
    assert channels == [f"project:{project_id}", f"user:{user_id}"]
    _channel, event = bus.published[0]
    assert event["event"] == "object:changed"
    payload = event["data"]
    assert isinstance(payload, dict)
    assert payload.get("project_id") == str(project_id)
    assert "ts" in payload


def test_emit_runtime_event_keeps_thread_and_project_publish() -> None:
    bus = FakeBus()
    dispatcher = RuntimeEventDispatcher(bus)  # type: ignore[arg-type]
    user_id = uuid4()
    project_id = uuid4()
    thread_id = uuid4()

    async def _runner() -> None:
        await dispatcher.emit_runtime_event(
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            event_name="run:status",
            data={"run_id": str(uuid4()), "status": "processing"},
        )

    asyncio.run(_runner())

    channels = [channel for channel, _ in bus.published]
    assert channels == [f"thread:{thread_id}", f"project:{project_id}", f"user:{user_id}"]

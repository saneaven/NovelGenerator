from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol


class RunEventBus(Protocol):
    async def publish(self, channel_key: str, event: dict[str, Any]) -> None: ...
    def subscribe(
        self,
        channel_key: str,
        *,
        after_event_id: int | None = None,
        start_from: Literal["history", "latest"] = "history",
    ) -> AsyncIterator[dict[str, Any]]: ...


@dataclass
class _Channel:
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    history: deque[dict[str, Any]] = field(default_factory=deque)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    next_event_id: int = 1


class InMemoryRunEventBus:
    def __init__(self, *, ttl_seconds: int = 900, max_history: int = 512) -> None:
        self._channels: dict[str, _Channel] = {}
        self._lock = asyncio.Lock()
        self._ttl = timedelta(seconds=max(ttl_seconds, 60))
        self._max_history = max(int(max_history), 64)
        self._cleanup_task: asyncio.Task | None = None

    @staticmethod
    def _normalize_channel_key(channel_key: str) -> str:
        key = str(channel_key or "").strip()
        if not key:
            raise ValueError("channel_key must be a non-empty string")
        return key

    async def _ensure_cleanup_task(self) -> None:
        if self._cleanup_task is not None and not self._cleanup_task.done():
            return

        async def _cleanup_loop() -> None:
            while True:
                await asyncio.sleep(60)
                cutoff = datetime.utcnow() - self._ttl
                async with self._lock:
                    for channel_key in list(self._channels.keys()):
                        channel = self._channels.get(channel_key)
                        if channel is None:
                            continue
                        if channel.subscribers:
                            continue
                        if channel.updated_at < cutoff:
                            del self._channels[channel_key]

        self._cleanup_task = asyncio.create_task(_cleanup_loop())

    async def publish(self, channel_key: str, event: dict[str, Any]) -> None:
        await self._ensure_cleanup_task()
        key = self._normalize_channel_key(channel_key)
        async with self._lock:
            channel = self._channels.get(key)
            if channel is None:
                channel = _Channel()
                self._channels[key] = channel
            event_id = channel.next_event_id
            channel.next_event_id += 1
            envelope = {"event_id": event_id, "event": event}
            channel.updated_at = datetime.utcnow()
            channel.history.append(envelope)
            while len(channel.history) > self._max_history:
                channel.history.popleft()
            subscribers = list(channel.subscribers)

        for queue in subscribers:
            try:
                queue.put_nowait(envelope)
            except asyncio.QueueFull:
                # Backpressure policy: drop oldest then enqueue latest.
                try:
                    queue.get_nowait()
                except Exception:
                    pass
                try:
                    queue.put_nowait(envelope)
                except Exception:
                    pass

    def subscribe(
        self,
        channel_key: str,
        *,
        after_event_id: int | None = None,
        start_from: Literal["history", "latest"] = "history",
    ) -> AsyncIterator[dict[str, Any]]:
        async def _generator() -> AsyncIterator[dict[str, Any]]:
            await self._ensure_cleanup_task()
            key = self._normalize_channel_key(channel_key)
            if start_from not in {"history", "latest"}:
                raise ValueError("start_from must be 'history' or 'latest'")

            queue: asyncio.Queue = asyncio.Queue(maxsize=256)
            backlog: list[dict[str, Any]] = []

            async with self._lock:
                channel = self._channels.get(key)
                if channel is None:
                    channel = _Channel()
                    self._channels[key] = channel
                if after_event_id is not None:
                    backlog = [
                        item
                        for item in channel.history
                        if int(item.get("event_id", 0)) > after_event_id
                    ]
                elif start_from == "latest":
                    backlog = []
                else:
                    backlog = list(channel.history)
                channel.subscribers.add(queue)
                channel.updated_at = datetime.utcnow()

            for item in backlog:
                yield item

            try:
                while True:
                    item = await queue.get()
                    yield item
            finally:
                async with self._lock:
                    channel = self._channels.get(key)
                    if channel is not None:
                        channel.subscribers.discard(queue)
                        channel.updated_at = datetime.utcnow()

        return _generator()


run_event_bus = InMemoryRunEventBus()

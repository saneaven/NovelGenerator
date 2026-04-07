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
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    history: deque[dict[str, Any]] = field(default_factory=deque)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    next_event_id: int = 1


class InMemoryRunEventBus:
    def __init__(self, *, ttl_seconds: int = 900, max_history: int = 128) -> None:
        self._channels: dict[str, _Channel] = {}
        self._channels_lock = asyncio.Lock()
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
                async with self._channels_lock:
                    for channel_key in list(self._channels.keys()):
                        channel = self._channels.get(channel_key)
                        if channel is None:
                            continue
                        if channel.subscribers:
                            continue
                        if channel.updated_at < cutoff:
                            del self._channels[channel_key]

        self._cleanup_task = asyncio.create_task(_cleanup_loop())

    async def _get_or_create_channel(self, key: str) -> _Channel:
        async with self._channels_lock:
            channel = self._channels.get(key)
            if channel is None:
                channel = _Channel()
                self._channels[key] = channel
            return channel

    async def publish(self, channel_key: str, event: dict[str, Any]) -> None:
        await self._ensure_cleanup_task()
        key = self._normalize_channel_key(channel_key)
        channel = await self._get_or_create_channel(key)

        async with channel.lock:
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

            channel = await self._get_or_create_channel(key)
            async with channel.lock:
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
                async with channel.lock:
                    channel.subscribers.discard(queue)
                    channel.updated_at = datetime.utcnow()
                    # Free history memory when no subscribers remain
                    if not channel.subscribers:
                        channel.history.clear()

        return _generator()


run_event_bus = InMemoryRunEventBus()

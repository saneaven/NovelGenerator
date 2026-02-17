from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Protocol


class RunEventBus(Protocol):
    async def publish(self, channel_key: str, event: dict) -> None: ...
    def subscribe(self, channel_key: str) -> AsyncIterator[dict]: ...


@dataclass
class _Channel:
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    history: deque[dict] = field(default_factory=deque)
    updated_at: datetime = field(default_factory=datetime.utcnow)


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

    async def publish(self, channel_key: str, event: dict) -> None:
        await self._ensure_cleanup_task()
        key = self._normalize_channel_key(channel_key)
        async with self._lock:
            channel = self._channels.get(key)
            if channel is None:
                channel = _Channel()
                self._channels[key] = channel
            channel.updated_at = datetime.utcnow()
            channel.history.append(event)
            while len(channel.history) > self._max_history:
                channel.history.popleft()
            subscribers = list(channel.subscribers)

        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Backpressure policy: drop oldest then enqueue latest.
                try:
                    queue.get_nowait()
                except Exception:
                    pass
                try:
                    queue.put_nowait(event)
                except Exception:
                    pass

    def subscribe(self, channel_key: str) -> AsyncIterator[dict]:
        async def _generator() -> AsyncIterator[dict]:
            await self._ensure_cleanup_task()
            key = self._normalize_channel_key(channel_key)

            queue: asyncio.Queue = asyncio.Queue(maxsize=256)
            backlog: list[dict] = []

            async with self._lock:
                channel = self._channels.get(key)
                if channel is None:
                    channel = _Channel()
                    self._channels[key] = channel
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

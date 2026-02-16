from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Protocol
from uuid import UUID


class RunEventBus(Protocol):
    async def publish(self, run_id: UUID, event: dict) -> None: ...
    def subscribe(self, run_id: UUID, *, after_seq: int | None = None) -> AsyncIterator[dict]: ...


@dataclass
class _RunChannel:
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    history: deque[dict] = field(default_factory=deque)
    updated_at: datetime = field(default_factory=datetime.utcnow)


class InMemoryRunEventBus:
    def __init__(self, *, ttl_seconds: int = 900, max_history: int = 512) -> None:
        self._channels: dict[UUID, _RunChannel] = {}
        self._lock = asyncio.Lock()
        self._ttl = timedelta(seconds=max(ttl_seconds, 60))
        self._max_history = max(int(max_history), 64)
        self._cleanup_task: asyncio.Task | None = None

    async def _ensure_cleanup_task(self) -> None:
        if self._cleanup_task is not None and not self._cleanup_task.done():
            return

        async def _cleanup_loop() -> None:
            while True:
                await asyncio.sleep(60)
                cutoff = datetime.utcnow() - self._ttl
                async with self._lock:
                    for run_id in list(self._channels.keys()):
                        channel = self._channels.get(run_id)
                        if channel is None:
                            continue
                        if channel.subscribers:
                            continue
                        if channel.updated_at < cutoff:
                            del self._channels[run_id]

        self._cleanup_task = asyncio.create_task(_cleanup_loop())

    async def publish(self, run_id: UUID, event: dict) -> None:
        await self._ensure_cleanup_task()
        async with self._lock:
            channel = self._channels.get(run_id)
            if channel is None:
                channel = _RunChannel()
                self._channels[run_id] = channel
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

    def subscribe(self, run_id: UUID, *, after_seq: int | None = None) -> AsyncIterator[dict]:
        async def _generator() -> AsyncIterator[dict]:
            await self._ensure_cleanup_task()

            queue: asyncio.Queue = asyncio.Queue(maxsize=256)
            backlog: list[dict] = []

            async with self._lock:
                channel = self._channels.get(run_id)
                if channel is None:
                    channel = _RunChannel()
                    self._channels[run_id] = channel
                if after_seq is None:
                    backlog = list(channel.history)
                else:
                    backlog = [
                        item
                        for item in channel.history
                        if int(item.get("event_seq") or 0) > after_seq
                    ]
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
                    channel = self._channels.get(run_id)
                    if channel is not None:
                        channel.subscribers.discard(queue)
                        channel.updated_at = datetime.utcnow()

        return _generator()


run_event_bus = InMemoryRunEventBus()

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol


_LOSSY_EVENT_NAMES = frozenset(
    {
        "content:delta",
        "thinking:delta",
        "tool_call:delta",
    }
)
_MAX_PENDING_DELTAS = 256


class RunEventBus(Protocol):
    async def publish(self, channel_key: str, event: dict[str, Any]) -> None: ...
    def subscribe(
        self,
        channel_key: str,
        *,
        after_event_id: int | None = None,
        start_from: Literal["history", "latest"] = "history",
    ) -> AsyncIterator[dict[str, Any]]: ...


@dataclass(eq=False)
class _Subscriber:
    state_pending: deque[dict[str, Any]] = field(default_factory=deque)
    delta_pending: deque[dict[str, Any]] = field(
        default_factory=lambda: deque(maxlen=_MAX_PENDING_DELTAS)
    )
    ready: asyncio.Event = field(default_factory=asyncio.Event)


@dataclass(frozen=True)
class _HistoryEntry:
    published_at: datetime
    envelope: dict[str, Any]


@dataclass
class _Channel:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    subscribers: set[_Subscriber] = field(default_factory=set)
    state_history: deque[_HistoryEntry] = field(default_factory=deque)
    delta_history: deque[_HistoryEntry] = field(default_factory=deque)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    next_event_id: int = 1


class InMemoryRunEventBus:
    """Replay state reliably while bounding best-effort streaming deltas."""

    def __init__(self, *, ttl_seconds: int = 900, max_history: int = 128) -> None:
        self._channels: dict[str, _Channel] = {}
        self._channels_lock = asyncio.Lock()
        self._ttl = timedelta(seconds=max(ttl_seconds, 60))
        self._max_delta_history = max(int(max_history), 64)
        self._cleanup_task: asyncio.Task | None = None

    @staticmethod
    def _is_lossy_event(event: dict[str, Any]) -> bool:
        return event.get("event") in _LOSSY_EVENT_NAMES

    def _prune_expired_history(self, channel: _Channel, *, now: datetime) -> None:
        cutoff = now - self._ttl
        for history in (channel.state_history, channel.delta_history):
            while history and history[0].published_at < cutoff:
                history.popleft()

    @staticmethod
    def _ordered_history(channel: _Channel) -> list[dict[str, Any]]:
        return sorted(
            (
                *(entry.envelope for entry in channel.state_history),
                *(entry.envelope for entry in channel.delta_history),
            ),
            key=lambda item: int(item.get("event_id", 0)),
        )

    @staticmethod
    def _pop_next_pending(subscriber: _Subscriber) -> dict[str, Any] | None:
        state = subscriber.state_pending
        delta = subscriber.delta_pending
        if state and delta:
            state_id = int(state[0].get("event_id", 0))
            delta_id = int(delta[0].get("event_id", 0))
            return state.popleft() if state_id < delta_id else delta.popleft()
        if state:
            return state.popleft()
        if delta:
            return delta.popleft()
        return None

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
                await self._cleanup_expired_channels()

        self._cleanup_task = asyncio.create_task(_cleanup_loop())

    async def _cleanup_expired_channels(self) -> None:
        cutoff = datetime.utcnow() - self._ttl
        async with self._channels_lock:
            for channel_key in list(self._channels.keys()):
                channel = self._channels.get(channel_key)
                if channel is None:
                    continue
                async with channel.lock:
                    if channel.subscribers:
                        continue
                    if channel.updated_at < cutoff:
                        del self._channels[channel_key]

    async def _acquire_channel(self, key: str) -> _Channel:
        await self._channels_lock.acquire()
        try:
            channel = self._channels.get(key)
            if channel is None:
                channel = _Channel()
                self._channels[key] = channel
            await channel.lock.acquire()
            return channel
        finally:
            self._channels_lock.release()

    async def publish(self, channel_key: str, event: dict[str, Any]) -> None:
        await self._ensure_cleanup_task()
        key = self._normalize_channel_key(channel_key)
        channel = await self._acquire_channel(key)
        try:
            event_id = channel.next_event_id
            channel.next_event_id += 1
            envelope = {"event_id": event_id, "event": event}
            now = datetime.utcnow()
            channel.updated_at = now
            self._prune_expired_history(channel, now=now)
            history_entry = _HistoryEntry(published_at=now, envelope=envelope)
            is_lossy = self._is_lossy_event(event)
            if is_lossy:
                channel.delta_history.append(history_entry)
                while len(channel.delta_history) > self._max_delta_history:
                    channel.delta_history.popleft()
            else:
                channel.state_history.append(history_entry)

            # Enqueue while holding the channel lock so concurrent publishers
            # cannot invert the globally assigned event order for subscribers.
            for subscriber in channel.subscribers:
                if is_lossy:
                    subscriber.delta_pending.append(envelope)
                else:
                    subscriber.state_pending.append(envelope)
                subscriber.ready.set()
        finally:
            channel.lock.release()

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

            subscriber = _Subscriber()
            backlog: list[dict[str, Any]] = []

            channel = await self._acquire_channel(key)
            try:
                self._prune_expired_history(channel, now=datetime.utcnow())
                history = self._ordered_history(channel)
                if after_event_id is not None:
                    backlog = [
                        item
                        for item in history
                        if int(item.get("event_id", 0)) > after_event_id
                    ]
                elif start_from == "latest":
                    backlog = []
                else:
                    backlog = history
                channel.subscribers.add(subscriber)
                channel.updated_at = datetime.utcnow()
            finally:
                channel.lock.release()

            try:
                for item in backlog:
                    yield item

                while True:
                    item = self._pop_next_pending(subscriber)
                    if item is None:
                        subscriber.ready.clear()
                        # No await occurs between clearing and checking again,
                        # so an event cannot be stranded by a lost wake-up.
                        item = self._pop_next_pending(subscriber)
                    if item is None:
                        await subscriber.ready.wait()
                        continue
                    yield item
            finally:
                async with channel.lock:
                    channel.subscribers.discard(subscriber)
                    channel.updated_at = datetime.utcnow()

        return _generator()


run_event_bus = InMemoryRunEventBus()

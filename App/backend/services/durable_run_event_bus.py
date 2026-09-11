from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, text


class DurableRunEventBus:
    """One durable user stream shared by API processes; no subscriber owns work.

    Completed stream history is retained for a day. Active message streams are
    retained until finalized so an arbitrarily long background run can hydrate.
    """
    def __init__(self, db_factory=None):
        self._db_factory = db_factory
        self._last_cleanup = datetime.min
        self._activity = asyncio.Condition()
        self._revision = 0

    def _session(self):
        if self._db_factory is not None:
            return self._db_factory()
        from ..database import SessionLocal
        return SessionLocal()

    async def publish(self, channel_key: str, event: dict) -> None:
        # RuntimeEventDispatcher also publishes legacy thread/project channels.
        # The only stream endpoint subscribes to the user channel.
        if not channel_key.startswith("user:"):
            return
        user_id = UUID(channel_key.removeprefix("user:"))
        await asyncio.to_thread(self._persist, user_id, event)
        async with self._activity:
            self._revision += 1
            self._activity.notify_all()

    def _persist(self, user_id: UUID, event: dict) -> None:
        from ..models.db_models import RuntimeEventModel, Thread
        with self._session() as db:
            # Allocate the sequence after the user lock. Sequence allocation
            # alone does not guarantee commit order between concurrent writers.
            db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"runtime:{user_id}"})
            thread_id = event.get("data", {}).get("thread_id")
            if thread_id:
                thread_id = UUID(str(thread_id))
                if db.get(Thread, thread_id) is None:
                    thread_id = None
            db.add(RuntimeEventModel(user_id=user_id, thread_id=thread_id, event=jsonable_encoder(event)))
            db.commit()

    def _read(self, user_id: UUID, after: int | None, start_from: str):
        from ..models.db_models import RuntimeEventModel
        with self._session() as db:
            low, high = db.query(func.min(RuntimeEventModel.id), func.max(RuntimeEventModel.id)).filter(
                RuntimeEventModel.user_id == user_id,
            ).one()
            high = high or 0
            if after is None:
                if start_from == "latest":
                    # Capture the cursor BEFORE the client hydrates. Otherwise
                    # events committed between hydration and subscribe are lost.
                    return high, [{"event_id": high, "event": {"event": "stream:reset", "data": {}}}]
                after = 0
            elif after > high or (low is not None and after < low and after != 0):
                return high, [{"event_id": high, "event": {"event": "stream:reset", "data": {}}}]
            rows = db.query(RuntimeEventModel).filter(
                RuntimeEventModel.user_id == user_id, RuntimeEventModel.id > after,
            ).order_by(RuntimeEventModel.id).limit(256).all()
            return after, [{"event_id": row.id, "event": row.event} for row in rows]

    def _cleanup(self) -> None:
        from ..models.db_models import RunMessageModel, RunModel, RuntimeEventModel
        with self._session() as db:
            active_threads = db.query(RunMessageModel.thread_id).join(RunModel, RunModel.id == RunMessageModel.run_id).filter(
                RunMessageModel.is_streaming.is_(True), RunModel.status == "running",
            )
            db.query(RuntimeEventModel).filter(
                RuntimeEventModel.created_at < datetime.utcnow() - timedelta(days=1),
                (RuntimeEventModel.thread_id.is_(None)) | (~RuntimeEventModel.thread_id.in_(active_threads)),
            ).delete(synchronize_session=False)
            db.commit()

    def subscribe(self, channel_key: str, *, after_event_id: int | None = None,
                  start_from: Literal["history", "latest"] = "history"):
        if not channel_key.startswith("user:"):
            raise ValueError("Only user-scoped runtime subscriptions are supported")
        user_id = UUID(channel_key.removeprefix("user:"))

        async def generate():
            cursor = after_event_id
            while True:
                revision = self._revision
                cursor, rows = await asyncio.to_thread(self._read, user_id, cursor, start_from)
                for row in rows:
                    cursor = row["event_id"]
                    yield row
                if datetime.utcnow() - self._last_cleanup > timedelta(minutes=5):
                    self._last_cleanup = datetime.utcnow()
                    await asyncio.to_thread(self._cleanup)
                if len(rows) < 256:
                    async with self._activity:
                        if self._revision == revision:
                            try:
                                await asyncio.wait_for(self._activity.wait(), timeout=1.0)
                            except asyncio.TimeoutError:
                                pass
        return generate()

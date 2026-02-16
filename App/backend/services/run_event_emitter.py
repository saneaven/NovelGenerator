from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from ..models.db_models import RunModel
from .run_event_bus import InMemoryRunEventBus, run_event_bus


@dataclass(frozen=True)
class RunEventContext:
    run_id: UUID
    thread_type: str
    project_id: UUID
    thread_id: UUID | None = None
    owner_id: UUID | None = None
    run_mode: str | None = None
    surface: str | None = None
    parent_run_id: UUID | None = None
    journey_kind: str | None = None

    @staticmethod
    def from_run(run: RunModel) -> "RunEventContext":
        thread = run.thread
        return RunEventContext(
            run_id=run.id,
            thread_type=thread.thread_type,
            project_id=run.project_id,
            thread_id=thread.id,
            owner_id=thread.owner_id,
            run_mode=run.run_mode,
            surface=run.surface,
            parent_run_id=run.parent_run_id,
            journey_kind=thread.journey_kind,
        )


class RunEventEmitter:
    def __init__(self, bus: InMemoryRunEventBus) -> None:
        self._bus = bus
        self._seq_by_thread: dict[UUID, int] = {}
        self._lock = asyncio.Lock()

    async def _next_seq(self, thread_id: UUID) -> int:
        async with self._lock:
            next_seq = self._seq_by_thread.get(thread_id, 0) + 1
            self._seq_by_thread[thread_id] = next_seq
            return next_seq

    @staticmethod
    def _base_payload(run: RunModel | RunEventContext) -> dict:
        if isinstance(run, RunModel):
            ctx = RunEventContext.from_run(run)
        else:
            ctx = run
        payload: dict[str, Any] = {
            "thread_type": ctx.thread_type,
            "project_id": str(ctx.project_id),
            "thread_id": str(ctx.thread_id) if ctx.thread_id else None,
        }
        if ctx.thread_type == "agent":
            payload.update(
                {
                    "owner_id": str(ctx.owner_id) if ctx.owner_id else None,
                    "run_mode": ctx.run_mode,
                    "surface": ctx.surface,
                }
            )
        elif ctx.thread_type == "subAgent":
            payload.update(
                {
                    "owner_id": str(ctx.owner_id) if ctx.owner_id else None,
                }
            )
        elif ctx.thread_type == "journey":
            payload.update({"journey_kind": ctx.journey_kind})
        return payload

    async def emit(self, event_name: str, run: RunModel | RunEventContext, payload: dict) -> dict:
        if isinstance(run, RunModel):
            thread_id = run.thread_id
        else:
            thread_id = run.thread_id
        if thread_id is None:
            raise ValueError("thread_id is required for event emission")
        seq = await self._next_seq(thread_id)
        event = {
            "event": event_name,
            "event_seq": seq,
            "ts": datetime.now(timezone.utc).isoformat(),
            **self._base_payload(run),
            "payload": payload,
        }
        await self._bus.publish(thread_id, event)
        return event

    async def emit_status(self, run: RunModel | RunEventContext, status: str, error: str | None = None) -> dict:
        body = {"status": status}
        if error:
            body["error"] = error
        return await self.emit("thread:status", run, body)

    async def emit_heartbeat(self, run: RunModel | RunEventContext) -> dict:
        return await self.emit("thread:heartbeat", run, {"ts": datetime.now(timezone.utc).isoformat()})


run_event_emitter = RunEventEmitter(run_event_bus)

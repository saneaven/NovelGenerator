from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from ..models.db_models import RunModel
from .run_event_bus import InMemoryRunEventBus, run_event_bus


@dataclass(frozen=True)
class RunEventContext:
    run_id: UUID
    run_type: str
    project_id: UUID
    agent_id: UUID | None = None
    run_mode: str | None = None
    surface: str | None = None
    sub_agent_id: UUID | None = None
    parent_run_id: UUID | None = None
    journey_kind: str | None = None

    @staticmethod
    def from_run(run: RunModel) -> "RunEventContext":
        return RunEventContext(
            run_id=run.id,
            run_type=run.run_type,
            project_id=run.project_id,
            agent_id=run.agent_id,
            run_mode=run.run_mode,
            surface=run.surface,
            sub_agent_id=run.sub_agent_id,
            parent_run_id=run.parent_run_id,
            journey_kind=run.journey_kind,
        )


class RunEventEmitter:
    def __init__(self, bus: InMemoryRunEventBus) -> None:
        self._bus = bus
        self._seq_by_run: dict[UUID, int] = {}
        self._lock = asyncio.Lock()

    async def _next_seq(self, run_id: UUID) -> int:
        async with self._lock:
            next_seq = self._seq_by_run.get(run_id, 0) + 1
            self._seq_by_run[run_id] = next_seq
            return next_seq

    @staticmethod
    def _base_payload(run: RunModel | RunEventContext) -> dict:
        if isinstance(run, RunModel):
            ctx = RunEventContext.from_run(run)
        else:
            ctx = run
        payload = {
            "run_id": str(ctx.run_id),
            "run_type": ctx.run_type,
            "project_id": str(ctx.project_id),
        }
        if ctx.run_type == "agent":
            payload.update(
                {
                    "agent_id": str(ctx.agent_id) if ctx.agent_id else None,
                    "run_mode": ctx.run_mode,
                    "surface": ctx.surface,
                }
            )
        elif ctx.run_type == "subAgent":
            payload.update(
                {
                    "sub_agent_id": str(ctx.sub_agent_id) if ctx.sub_agent_id else None,
                    "parent_run_id": str(ctx.parent_run_id) if ctx.parent_run_id else None,
                }
            )
        elif ctx.run_type == "journey":
            payload.update({"journey_kind": ctx.journey_kind})
        return payload

    async def emit(self, event_name: str, run: RunModel | RunEventContext, payload: dict) -> dict:
        if isinstance(run, RunModel):
            run_id = run.id
        else:
            run_id = run.run_id
        seq = await self._next_seq(run_id)
        event = {
            "event": event_name,
            "event_seq": seq,
            "ts": datetime.now(timezone.utc).isoformat(),
            **self._base_payload(run),
            "payload": payload,
        }
        await self._bus.publish(run_id, event)
        return event

    async def emit_status(self, run: RunModel | RunEventContext, status: str, error: str | None = None) -> dict:
        body = {"status": status}
        if error:
            body["error"] = error
        return await self.emit("run:status", run, body)

    async def emit_heartbeat(self, run: RunModel | RunEventContext) -> dict:
        return await self.emit("run:heartbeat", run, {"ts": datetime.now(timezone.utc).isoformat()})


run_event_emitter = RunEventEmitter(run_event_bus)

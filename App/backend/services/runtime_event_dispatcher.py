from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from .run_event_bus import InMemoryRunEventBus, run_event_bus


def _to_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return str(value)
    text = str(value).strip()
    return text or None


class RuntimeEventDispatcher:
    def __init__(self, bus: InMemoryRunEventBus) -> None:
        self._bus = bus

    async def emit_runtime_event(
        self,
        *,
        project_id: UUID | str,
        thread_id: UUID | str,
        event_name: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        project_id_str = _to_str(project_id)
        thread_id_str = _to_str(thread_id)
        if not project_id_str or not thread_id_str:
            raise ValueError("project_id and thread_id are required")

        run_id_raw = data.get("run_id")
        payload = {
            **data,
            "project_id": project_id_str,
            "thread_id": thread_id_str,
            "run_id": _to_str(run_id_raw),
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        event = {
            "event": event_name,
            "data": payload,
        }

        await self._bus.publish(f"thread:{thread_id_str}", event)
        await self._bus.publish(f"project:{project_id_str}", event)
        return event

    async def emit_project_event(
        self,
        *,
        project_id: UUID | str,
        event_name: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        project_id_str = _to_str(project_id)
        if not project_id_str:
            raise ValueError("project_id is required")

        payload = {
            **data,
            "project_id": project_id_str,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        event = {
            "event": event_name,
            "data": payload,
        }

        await self._bus.publish(f"project:{project_id_str}", event)
        return event


runtime_event_dispatcher = RuntimeEventDispatcher(run_event_bus)


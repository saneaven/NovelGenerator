from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from .run_event_bus import InMemoryRunEventBus, run_event_bus

logger = logging.getLogger(__name__)


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

        if event_name == "run:status":
            notification_payload = self._sync_journey_notification_payload(
                thread_id=thread_id_str,
                status=str(data.get("status") or ""),
                error=data.get("error"),
            )
            if notification_payload is not None:
                await self.emit_project_event(
                    project_id=project_id_str,
                    event_name="notification:upsert",
                    data=notification_payload,
                )

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

    @staticmethod
    def _sync_journey_notification_payload(
        *,
        thread_id: str,
        status: str,
        error: Any,
    ) -> dict[str, Any] | None:
        db = None
        try:
            from ..database import SessionLocal
            from .notification_service import serialize_notification, sync_journey_notification_from_runtime_status

            db = SessionLocal()
            row = sync_journey_notification_from_runtime_status(
                db,
                thread_id=thread_id,
                status=status,
                error=str(error) if isinstance(error, str) and error.strip() else None,
            )
            if row is None:
                db.rollback()
                return None

            db.commit()
            db.refresh(row)
            return serialize_notification(row)
        except Exception:
            if db is not None:
                db.rollback()
            logger.exception("Failed to sync journey notification from run:status event")
            return None
        finally:
            if db is not None:
                db.close()


runtime_event_dispatcher = RuntimeEventDispatcher(run_event_bus)


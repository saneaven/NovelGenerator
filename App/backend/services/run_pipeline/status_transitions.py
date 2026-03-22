from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from sqlalchemy.orm import Session

from ...models.db_models import RunModel, Thread
from ..runtime_event_dispatcher import RuntimeEventDispatcher
from ..storage_usage_service import (
    apply_project_usage_deltas,
    build_run_delta,
    snapshot_run_row,
)
from ..thread_runtime_sync_service import emit_runtime_sync_events, sync_explicit_run_thread_status
from .runtime import RunPipelineRuntime


class RunStatusTransitions:
    def __init__(
        self,
        *,
        runtime: RunPipelineRuntime,
        event_dispatcher: RuntimeEventDispatcher,
    ) -> None:
        self._runtime = runtime
        self._event_dispatcher = event_dispatcher

    async def sync_status_side_effects(
        self,
        db: Session,
        *,
        run: RunModel,
        thread: Thread,
        error: str | None,
        emit_error: bool = False,
        emit_run_status: bool = True,
        extra_status_data: dict[str, Any] | None = None,
        pre_emit_events: list[tuple[str, dict[str, Any]]] | None = None,
    ) -> None:
        sync_result = sync_explicit_run_thread_status(
            db,
            run=run,
            thread=thread,
            error=error,
        )
        db.commit()
        for event_name, payload in pre_emit_events or []:
            await self._runtime.emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name=event_name,
                data=payload,
            )
        if emit_error and error:
            await self._runtime.emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="run:error",
                data={
                    "run_id": str(run.id),
                    "error": error,
                },
            )
        await emit_runtime_sync_events(
            SimpleNamespace(
                emit_runtime_event=self._runtime.emit,
                emit_project_event=getattr(self._event_dispatcher, "emit_project_event", None),
            ),
            result=sync_result,
            emit_run_status=emit_run_status,
            extra_status_data=extra_status_data,
        )

    async def apply_status_transition(
        self,
        db: Session,
        *,
        run: RunModel,
        thread: Thread,
        status: str,
        error: str | None,
        emit_error: bool = False,
        emit_run_status: bool = True,
        extra_status_data: dict[str, Any] | None = None,
        pre_emit_events: list[tuple[str, dict[str, Any]]] | None = None,
    ) -> None:
        run_before = snapshot_run_row(run)
        run.status = status
        run.error = error if status == "error" else None
        thread.status = status
        apply_project_usage_deltas(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            deltas=[build_run_delta(run_before, snapshot_run_row(run))],
            enforce_quota=False,
        )
        db.flush()
        await self.sync_status_side_effects(
            db,
            run=run,
            thread=thread,
            error=error,
            emit_error=emit_error,
            emit_run_status=emit_run_status,
            extra_status_data=extra_status_data,
            pre_emit_events=pre_emit_events,
        )

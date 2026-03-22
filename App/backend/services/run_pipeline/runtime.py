from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Protocol
from uuid import UUID

from ..runtime_event_dispatcher import RuntimeEventDispatcher
from .contracts import CreateContext


class ExecuteLoopFn(Protocol):
    def __call__(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> Awaitable[None]:
        ...


class RunPipelineRuntime:
    def __init__(self, event_dispatcher: RuntimeEventDispatcher) -> None:
        self._event_dispatcher = event_dispatcher
        self._tasks: dict[UUID, asyncio.Task] = {}
        self._task_lock = asyncio.Lock()
        self._thread_locks: dict[UUID, asyncio.Lock] = {}

    def thread_lock(self, thread_id: UUID) -> asyncio.Lock:
        lock = self._thread_locks.get(thread_id)
        if lock is None:
            lock = asyncio.Lock()
            self._thread_locks[thread_id] = lock
        return lock

    async def emit(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        thread_id: UUID,
        event_name: str,
        data: dict[str, Any],
    ) -> None:
        await self._event_dispatcher.emit_runtime_event(
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            event_name=event_name,
            data=data,
        )

    async def spawn_task(
        self,
        run_id: UUID,
        *,
        execute_loop_fn: ExecuteLoopFn,
        create_ctx: CreateContext | None = None,
    ) -> None:
        async with self._task_lock:
            existing = self._tasks.get(run_id)
            if existing is not None and not existing.done():
                return

            task = asyncio.create_task(execute_loop_fn(run_id, create_ctx=create_ctx))
            self._tasks[run_id] = task

            def _cleanup(done_task: asyncio.Task) -> None:
                _ = done_task
                self._tasks.pop(run_id, None)

            task.add_done_callback(_cleanup)

    async def cancel_task_and_wait(self, run_id: UUID, *, timeout_s: float = 5.0) -> bool:
        task: asyncio.Task | None = None
        async with self._task_lock:
            existing = self._tasks.get(run_id)
            if existing is None or existing.done():
                return True
            existing.cancel()
            task = existing

        try:
            await asyncio.wait_for(task, timeout=max(float(timeout_s), 0.1))
            return True
        except asyncio.CancelledError:
            return True
        except asyncio.TimeoutError:
            return False
        except Exception:
            return True

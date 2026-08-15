from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Awaitable, Callable, Protocol
from uuid import UUID

from ..runtime_event_dispatcher import RuntimeEventDispatcher
from .contracts import CreateContext

logger = logging.getLogger(__name__)

DEFAULT_RUN_SETUP_CONCURRENCY = 2


def _resolve_setup_concurrency() -> int:
    try:
        value = int(os.getenv("RUN_SETUP_CONCURRENCY", str(DEFAULT_RUN_SETUP_CONCURRENCY)))
    except ValueError:
        return DEFAULT_RUN_SETUP_CONCURRENCY
    return max(1, value)


class ExecuteLoopFn(Protocol):
    def __call__(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> Awaitable[None]:
        ...


class SetupSlot:
    """Idempotent handle for a run-setup semaphore permit.

    The permit covers only the blocking pre-stream phase (prompt assembly,
    execution prepare, placeholder insert).  Both the orchestrator and
    ``execute_loop``'s ``finally`` call ``release()``, so it must be safe to
    call more than once.
    """

    def __init__(self, semaphore: asyncio.Semaphore) -> None:
        self._semaphore = semaphore
        self._held = False

    @property
    def held(self) -> bool:
        return self._held

    async def acquire(self, on_wait: Callable[[], Awaitable[None]] | None = None) -> None:
        if self._held:
            return
        # Only signal "queued" when the run actually has to wait.
        if on_wait is not None and self._semaphore.locked():
            await on_wait()
        await self._semaphore.acquire()
        self._held = True

    def release(self) -> None:
        if not self._held:
            return
        self._held = False
        self._semaphore.release()


class NullSetupSlot(SetupSlot):
    """No-op slot for call sites that run outside the gate (tests, sub-pipelines)."""

    def __init__(self) -> None:  # pylint: disable=super-init-not-called
        self._held = False

    async def acquire(self, on_wait: Callable[[], Awaitable[None]] | None = None) -> None:
        return

    def release(self) -> None:
        return


class RunPipelineRuntime:
    def __init__(self, event_dispatcher: RuntimeEventDispatcher) -> None:
        self._event_dispatcher = event_dispatcher
        self._tasks: dict[UUID, asyncio.Task] = {}
        self._task_lock = asyncio.Lock()
        self._thread_locks: dict[UUID, asyncio.Lock] = {}
        self._setup_semaphore = asyncio.Semaphore(_resolve_setup_concurrency())

    def setup_slot(self) -> SetupSlot:
        return SetupSlot(self._setup_semaphore)

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
                self._tasks.pop(run_id, None)
                if done_task.cancelled():
                    return
                exc = done_task.exception()
                if exc is not None:
                    logger.error("Run %s task crashed: %r", run_id, exc, exc_info=exc)

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

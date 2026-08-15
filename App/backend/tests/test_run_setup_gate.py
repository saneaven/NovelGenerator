"""The setup gate serializes the blocking pre-stream phase, not streaming."""

from __future__ import annotations

import asyncio

import pytest

from App.backend.tests.run_pipeline_test_support import (
    FakeSession,
    UserSettings,
    build_runtime_stack,
    make_run_and_thread,
    run_service,
)
from App.backend.services.run_pipeline import execution_loop as execution_loop_module
from App.backend.services.run_pipeline.runtime import (
    NullSetupSlot,
    SetupSlot,
    _resolve_setup_concurrency,
)


def _assert_all_permits_returned(stack) -> None:
    semaphore = stack.runtime._setup_semaphore  # pylint: disable=protected-access
    assert semaphore._value == _resolve_setup_concurrency()  # pylint: disable=protected-access


def test_setup_slot_release_is_idempotent() -> None:
    async def _run() -> None:
        semaphore = asyncio.Semaphore(1)
        slot = SetupSlot(semaphore)
        await slot.acquire()
        assert semaphore.locked()
        slot.release()
        slot.release()
        # A double release must not hand out an extra permit.
        assert not semaphore.locked()
        assert semaphore._value == 1  # pylint: disable=protected-access

    asyncio.run(_run())


def test_setup_slot_acquire_is_reentrant_while_held() -> None:
    async def _run() -> None:
        semaphore = asyncio.Semaphore(1)
        slot = SetupSlot(semaphore)
        await slot.acquire()
        await asyncio.wait_for(slot.acquire(), timeout=0.5)
        slot.release()
        assert not semaphore.locked()

    asyncio.run(_run())


def test_setup_slot_signals_on_wait_only_when_contended() -> None:
    async def _run() -> None:
        semaphore = asyncio.Semaphore(1)
        waits: list[str] = []

        async def _on_wait() -> None:
            waits.append("queued")

        first = SetupSlot(semaphore)
        await first.acquire(_on_wait)
        assert waits == []

        second = SetupSlot(semaphore)
        task = asyncio.create_task(second.acquire(_on_wait))
        await asyncio.sleep(0)
        assert waits == ["queued"]
        assert not task.done()

        first.release()
        await asyncio.wait_for(task, timeout=1.0)
        second.release()

    asyncio.run(_run())


def test_null_setup_slot_never_blocks() -> None:
    async def _run() -> None:
        slot = NullSetupSlot()
        await asyncio.wait_for(slot.acquire(), timeout=0.5)
        slot.release()
        slot.release()

    asyncio.run(_run())


def test_execute_loop_releases_slot_before_streaming(monkeypatch: pytest.MonkeyPatch) -> None:
    """The slot must be handed back once the orchestrator reaches the stream."""
    run, thread = make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    stack = build_runtime_stack(lambda: session)
    observed: dict[str, bool] = {}

    async def _assemble_create(*_args: object, **_kwargs: object):
        return "system", [], {}, []

    async def _execute(_self: object, request: object, _callbacks: object) -> None:
        observed["held_during_setup"] = request.setup_slot.held
        # Stand in for emit_message_start -> release -> execute_stream.
        request.setup_slot.release()
        observed["held_during_stream"] = request.setup_slot.held

    monkeypatch.setattr(
        execution_loop_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: UserSettings(),
    )
    monkeypatch.setattr(execution_loop_module.prompt_assembly, "assemble_create", _assemble_create)
    monkeypatch.setattr(execution_loop_module.LLMExecutionOrchestrator, "execute", _execute)

    asyncio.run(
        stack.execution_loop.execute_loop(
            run.id,
            create_ctx=run_service.CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert observed == {"held_during_setup": True, "held_during_stream": False}
    _assert_all_permits_returned(stack)


def test_execute_loop_releases_slot_when_setup_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread = make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    stack = build_runtime_stack(lambda: session)

    async def _boom(*_args: object, **_kwargs: object):
        raise RuntimeError("assembly exploded")

    monkeypatch.setattr(
        execution_loop_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: UserSettings(),
    )
    monkeypatch.setattr(execution_loop_module.prompt_assembly, "assemble_create", _boom)

    asyncio.run(
        stack.execution_loop.execute_loop(
            run.id,
            create_ctx=run_service.CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    _assert_all_permits_returned(stack)

from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from App.backend.tests.run_pipeline_test_support import (
    FakeActiveRunDb,
    FakeResumeRunDb,
    ResumeRunCommand,
    RunModel,
    Thread,
    build_runtime_stack,
    derive_run_status,
)
from App.backend.services.run_pipeline import lifecycle as lifecycle_module


def test_resume_run_rejects_when_pending_tool_call_exists() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="waiting")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="waiting",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run, pending_tool=object())
    stack = build_runtime_stack(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            stack.lifecycle.resume_run(
                ResumeRunCommand(
                    thread_id=thread.id,
                    user_id=thread.user_id,
                    run_mode=None,
                    surface=None,
                    context_object_ids=[],
                    journey_target_ids=[],
                    language=None,
                )
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Unresolved tool call exists in latest run"


def test_resume_run_rejects_error_latest_run_when_pending_tool_call_exists() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="error")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="error",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run, pending_tool=object())
    stack = build_runtime_stack(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            stack.lifecycle.resume_run(
                ResumeRunCommand(
                    thread_id=thread.id,
                    user_id=thread.user_id,
                    run_mode=None,
                    surface=None,
                    context_object_ids=[],
                    journey_target_ids=[],
                    language=None,
                )
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Unresolved tool call exists in latest run"


def test_resume_run_rejects_when_no_latest_run_exists() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="waiting")
    db = FakeResumeRunDb(thread=thread, run=None)
    stack = build_runtime_stack(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            stack.lifecycle.resume_run(
                ResumeRunCommand(
                    thread_id=thread.id,
                    user_id=thread.user_id,
                    run_mode=None,
                    surface=None,
                    context_object_ids=[],
                    journey_target_ids=[],
                    language=None,
                )
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "No run exists to resume"


def test_resume_run_rejects_when_processing_tool_call_exists_in_latest_run() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="processing")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="processing",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run, unresolved_tool=object())
    stack = build_runtime_stack(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            stack.lifecycle.resume_run(
                ResumeRunCommand(
                    thread_id=thread.id,
                    user_id=thread.user_id,
                    run_mode=None,
                    surface=None,
                    context_object_ids=[],
                    journey_target_ids=[],
                    language=None,
                )
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Unresolved tool call exists in latest run"


def test_resume_run_rejects_running_latest_run() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="running")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run)
    stack = build_runtime_stack(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            stack.lifecycle.resume_run(
                ResumeRunCommand(
                    thread_id=thread.id,
                    user_id=thread.user_id,
                    run_mode=None,
                    surface=None,
                    context_object_ids=[],
                    journey_target_ids=[],
                    language=None,
                )
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Run status 'running' is not resumable"


def test_resume_run_allows_error_latest_run() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="error")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="error",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run)
    stack = build_runtime_stack(lambda: db)
    spawned_run_ids: list[UUID] = []

    async def _spawn_task(run_id: UUID, *, execute_loop_fn=None, create_ctx=None) -> None:
        del execute_loop_fn, create_ctx
        spawned_run_ids.append(run_id)

    stack.runtime.spawn_task = _spawn_task  # type: ignore[method-assign]

    resumed = asyncio.run(
        stack.lifecycle.resume_run(
            ResumeRunCommand(
                thread_id=thread.id,
                user_id=thread.user_id,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
                language=None,
            )
        )
    )

    assert resumed is run
    assert run.status == "running"
    assert run.error is None
    assert thread.status == "running"
    assert db.commits == 1
    assert spawned_run_ids == [run.id]


@pytest.mark.parametrize(
    ("tool_statuses", "expected"),
    [
        ([], "paused"),
        (["applied"], "paused"),
        (["pending"], "paused"),
        (["processing"], "paused"),
        (["rejected"], "paused"),
        (["failed"], "paused"),
    ],
)
def test_derive_run_status_keeps_paused_sticky(tool_statuses: list[str], expected: str) -> None:
    assert derive_run_status(current_status="paused", tool_call_statuses=tool_statuses) == expected


def test_pause_run_marks_sub_agent_paused_without_parent_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="subAgent",
        status="running",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
        input_payload={},
    )
    run.thread = thread
    fake_db = FakeActiveRunDb(run=run, thread=thread)
    stack = build_runtime_stack(lambda: fake_db)

    canceled_run_ids: list[object] = []
    emitted: list[tuple[str, dict[str, object]]] = []
    parent_calls: list[tuple[object, object]] = []

    async def _fake_cancel_task_and_wait(run_id: object, *, timeout_s: float = 5.0) -> bool:
        _ = timeout_s
        canceled_run_ids.append(run_id)
        return True

    async def _fake_emit(*, user_id: object, project_id: object, thread_id: object, event_name: str, data: dict[str, object]) -> None:
        _ = user_id, project_id, thread_id
        emitted.append((event_name, data))

    async def _fake_propagate_child_terminal_state_to_parent(*args: object, **kwargs: object) -> None:
        parent_calls.append((args, kwargs))

    stack.runtime.cancel_task_and_wait = _fake_cancel_task_and_wait  # type: ignore[method-assign]
    stack.runtime.emit = _fake_emit  # type: ignore[method-assign]
    monkeypatch.setattr(
        lifecycle_module.tool_engine,
        "propagate_child_terminal_state_to_parent",
        _fake_propagate_child_terminal_state_to_parent,
    )

    asyncio.run(stack.lifecycle.pause_run(thread_id=thread.id, user_id=thread.user_id))

    assert run.status == "paused"
    assert thread.status == "paused"
    assert canceled_run_ids == [run.id]
    assert emitted == [("run:status", {"run_id": str(run.id), "status": "paused", "error": None})]
    assert parent_calls == []


def test_cancel_run_allows_paused_and_propagates_parent_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="subAgent",
        status="paused",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="paused",
        language="English",
        input_payload={},
    )
    run.thread = thread
    fake_db = FakeActiveRunDb(run=run, thread=thread)
    stack = build_runtime_stack(lambda: fake_db)

    emitted: list[tuple[str, dict[str, object]]] = []
    parent_calls: list[dict[str, object]] = []

    async def _fake_cancel_task_and_wait(_run_id: object, *, timeout_s: float = 5.0) -> bool:
        _ = timeout_s
        return True

    async def _fake_emit(*, user_id: object, project_id: object, thread_id: object, event_name: str, data: dict[str, object]) -> None:
        _ = user_id, project_id, thread_id
        emitted.append((event_name, data))

    async def _fake_propagate_child_terminal_state_to_parent(_db: object, *, thread: object, run: object, emit: object) -> None:
        _ = emit
        parent_calls.append(
            {
                "thread_status": getattr(thread, "status", None),
                "run_status": getattr(run, "status", None),
            }
        )

    stack.runtime.cancel_task_and_wait = _fake_cancel_task_and_wait  # type: ignore[method-assign]
    stack.runtime.emit = _fake_emit  # type: ignore[method-assign]
    monkeypatch.setattr(
        lifecycle_module.tool_engine,
        "propagate_child_terminal_state_to_parent",
        _fake_propagate_child_terminal_state_to_parent,
    )

    asyncio.run(stack.lifecycle.cancel_run(thread_id=thread.id, user_id=thread.user_id))

    assert run.status == "canceled"
    assert thread.status == "canceled"
    assert emitted == [
        ("run:status", {"run_id": str(run.id), "status": "canceled", "error": None}),
        ("run:canceled", {"run_id": str(run.id)}),
    ]
    assert parent_calls == [{"thread_status": "canceled", "run_status": "canceled"}]

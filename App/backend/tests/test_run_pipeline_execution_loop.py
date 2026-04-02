from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from jinja2.exceptions import TemplateSyntaxError, UndefinedError

from App.backend.tests.run_pipeline_test_support import (
    FakeSession,
    FragmentNotFoundError,
    UserSettings,
    build_runtime_stack,
    format_template_error,
    format_user_run_error,
    make_run_and_thread,
    run_service,
)
from App.backend.services.run_pipeline import execution_loop as execution_loop_module


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (
            FragmentNotFoundError("fragment:missing/path"),
            "Referenced fragment not found: fragment:missing/path",
        ),
        (
            TemplateSyntaxError("bad syntax", 1),
            format_template_error(TemplateSyntaxError("bad syntax", 1)),
        ),
        (
            UndefinedError("'foo' is undefined"),
            format_template_error(UndefinedError("'foo' is undefined")),
        ),
        (
            RuntimeError("boom"),
            "boom",
        ),
        (
            RuntimeError("   "),
            "Run failed.",
        ),
    ],
)
def test_format_user_run_error(exc: Exception, expected: str) -> None:
    assert format_user_run_error(exc) == expected


def test_execute_loop_formats_template_errors_for_user(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread = make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    stack = build_runtime_stack(lambda: session)

    async def _raise_fragment_not_found(*_args: object, **_kwargs: object) -> object:
        raise FragmentNotFoundError("fragment:missing/path")

    async def _should_not_execute(_self: object, *_args: object, **_kwargs: object) -> None:
        raise AssertionError("execute should not be called when prompt assembly fails")

    monkeypatch.setattr(
        execution_loop_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: UserSettings(),
    )
    monkeypatch.setattr(execution_loop_module.prompt_assembly, "assemble_create", _raise_fragment_not_found)
    monkeypatch.setattr(execution_loop_module.LLMExecutionOrchestrator, "execute", _should_not_execute)

    asyncio.run(
        stack.execution_loop.execute_loop(
            run.id,
            create_ctx=run_service.CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    assert run.error == "Referenced fragment not found: fragment:missing/path"
    assert thread.status == "error"

    error_events = [
        event for event in stack.dispatcher.events if event["event_name"] in {"run:error", "run:status"}
    ]
    assert len(error_events) == 3
    assert error_events[0]["data"] == {"run_id": str(run.id), "status": "running", "thread_type": "agent"}
    assert error_events[1]["data"] == {
        "run_id": str(run.id),
        "error": "Referenced fragment not found: fragment:missing/path",
    }
    assert error_events[2]["data"] == {
        "run_id": str(run.id),
        "status": "error",
        "error": "Referenced fragment not found: fragment:missing/path",
    }


def test_execute_loop_preserves_non_template_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread = make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    stack = build_runtime_stack(lambda: session)

    async def _raise_runtime_error(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("boom")

    monkeypatch.setattr(
        execution_loop_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: SimpleNamespace(),
    )
    monkeypatch.setattr(execution_loop_module.prompt_assembly, "assemble_create", _raise_runtime_error)

    asyncio.run(
        stack.execution_loop.execute_loop(
            run.id,
            create_ctx=run_service.CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    assert run.error == "boom"
    assert thread.status == "error"

    run_error_event = next(event for event in stack.dispatcher.events if event["event_name"] == "run:error")
    run_status_event = stack.dispatcher.events[-1]
    assert run_error_event["data"] == {"run_id": str(run.id), "error": "boom"}
    assert run_status_event["event_name"] == "run:status"
    assert run_status_event["data"] == {"run_id": str(run.id), "status": "error", "error": "boom"}


def test_execute_loop_midstream_failure_emits_message_error_and_discards_placeholder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run, thread = make_run_and_thread()
    assistant_message = run_service.RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={"English": {"contentParts": []}},
    )
    session = FakeSession(run=run, thread=thread, assistant_message=assistant_message)
    stack = build_runtime_stack(lambda: session)
    request_fail_calls: list[dict[str, object]] = []

    async def _assemble_create(*_args: object, **_kwargs: object) -> tuple[str, list[dict[str, object]], None]:
        return "system", [], None

    async def _failing_execute(_self: object, request: object, _callbacks: object) -> None:
        request.checkpoint.message_id = assistant_message.id
        request.checkpoint.request_id = "req_123"
        request.checkpoint.finalized = False
        raise RuntimeError("stream blew up")

    monkeypatch.setattr(
        execution_loop_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: UserSettings(),
    )
    monkeypatch.setattr(
        execution_loop_module.llm_request_service,
        "fail",
        lambda request_id, **kwargs: request_fail_calls.append({"request_id": request_id, **kwargs}),
    )
    monkeypatch.setattr(execution_loop_module.prompt_assembly, "assemble_create", _assemble_create)
    monkeypatch.setattr(execution_loop_module.LLMExecutionOrchestrator, "execute", _failing_execute)

    asyncio.run(
        stack.execution_loop.execute_loop(
            run.id,
            create_ctx=run_service.CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    assert thread.status == "error"
    assert session.assistant_message is None
    assert [event["event_name"] for event in stack.dispatcher.events] == [
        "run:status",
        "message:error",
        "run:error",
        "run:status",
    ]
    assert stack.dispatcher.events[1]["data"] == {
        "run_id": str(run.id),
        "message_id": str(assistant_message.id),
        "request_id": "req_123",
        "error": "stream blew up",
    }
    assert request_fail_calls == [
        {
            "request_id": "req_123",
            "error": "stream blew up",
            "meta": None,
        }
    ]
    assert not any(event["event_name"] == "message:end" for event in stack.dispatcher.events)


def test_execute_loop_finalized_failure_keeps_message_without_message_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run, thread = make_run_and_thread()
    assistant_message = run_service.RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={"English": {"contentParts": [{"type": "content", "text": "done"}]}},
    )
    session = FakeSession(run=run, thread=thread, assistant_message=assistant_message)
    stack = build_runtime_stack(lambda: session)

    async def _assemble_create(*_args: object, **_kwargs: object) -> tuple[str, list[dict[str, object]], None]:
        return "system", [], None

    async def _finalized_then_fail(_self: object, request: object, callbacks: object) -> None:
        request.checkpoint.message_id = assistant_message.id
        request.checkpoint.finalized = True
        await callbacks.emit_fn(
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            event_name="message:end",
            data={
                "run_id": str(run.id),
                "message_id": str(assistant_message.id),
                "seq_in_thread": int(assistant_message.seq_in_thread),
                "data": assistant_message.data,
                "tool_calls": [],
            },
        )
        raise RuntimeError("post commit boom")

    monkeypatch.setattr(
        execution_loop_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: UserSettings(),
    )
    monkeypatch.setattr(execution_loop_module.prompt_assembly, "assemble_create", _assemble_create)
    monkeypatch.setattr(execution_loop_module.LLMExecutionOrchestrator, "execute", _finalized_then_fail)

    asyncio.run(
        stack.execution_loop.execute_loop(
            run.id,
            create_ctx=run_service.CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    assert thread.status == "error"
    assert session.assistant_message is assistant_message
    assert [event["event_name"] for event in stack.dispatcher.events] == [
        "run:status",
        "message:end",
        "run:error",
        "run:status",
    ]
    assert not any(event["event_name"] == "message:error" for event in stack.dispatcher.events)


def test_execute_loop_cancelled_error_preserves_paused_status(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread = make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    stack = build_runtime_stack(lambda: session)

    async def _assemble_create(*_args: object, **_kwargs: object) -> tuple[str, list[dict[str, object]], None]:
        return "system", [], None

    async def _cancelled_execute(_self: object, request: object, _callbacks: object) -> None:
        request.run.status = "paused"
        request.thread.status = "paused"
        raise asyncio.CancelledError()

    monkeypatch.setattr(
        execution_loop_module.settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: UserSettings(),
    )
    monkeypatch.setattr(execution_loop_module.prompt_assembly, "assemble_create", _assemble_create)
    monkeypatch.setattr(execution_loop_module.LLMExecutionOrchestrator, "execute", _cancelled_execute)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            stack.execution_loop.execute_loop(
                run.id,
                create_ctx=run_service.CreateContext(input_text="pause me", input_payload={}),
            )
        )

    assert run.status == "paused"
    assert thread.status == "paused"

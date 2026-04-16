from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ....models.db_models import RunMessageModel, RunModel, Thread
from ....providers.contracts import FinalSnapshot
from ...tool_engine import tool_engine
from .contracts import LLMExecutionCallbacks


async def emit_message_start(
    callbacks: LLMExecutionCallbacks,
    *,
    run: RunModel,
    thread: Thread,
    assistant_message: RunMessageModel,
    request_id: str,
) -> None:
    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="message:start",
        data={
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "request_id": request_id,
            "role": "assistant",
            "seq": int(assistant_message.seq),
            "seq_in_thread": int(assistant_message.seq_in_thread),
        },
    )


async def emit_llm_request(
    callbacks: LLMExecutionCallbacks,
    *,
    run: RunModel,
    thread: Thread,
    assistant_message: RunMessageModel,
    request_id: str,
    retry_count: int,
    provider: str,
    model: str,
    raw_request: dict[str, Any],
) -> None:
    _ = raw_request
    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="llm:request",
        data={
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "request_id": request_id,
            "retry_count": retry_count,
            "provider": provider,
            "model": model,
        },
    )


async def emit_content_delta(
    callbacks: LLMExecutionCallbacks,
    *,
    run: RunModel,
    thread: Thread,
    assistant_message: RunMessageModel,
    request_id: str,
    text: str,
) -> None:
    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="content:delta",
        data={
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "request_id": request_id,
            "text": text,
        },
    )


async def emit_thinking_delta(
    callbacks: LLMExecutionCallbacks,
    *,
    run: RunModel,
    thread: Thread,
    assistant_message: RunMessageModel,
    request_id: str,
    text: str,
    thinking_display: str,
) -> None:
    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="thinking:delta",
        data={
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "request_id": request_id,
            "text": text,
            "thinking_display": thinking_display,
        },
    )


async def emit_tool_call_start(
    callbacks: LLMExecutionCallbacks,
    *,
    run: RunModel,
    thread: Thread,
    assistant_message: RunMessageModel,
    request_id: str,
    stream_key: str,
    tool_call_id: str,
    index: int | None,
) -> None:
    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="tool_call:start",
        data={
            "run_id": str(run.id),
            "request_id": request_id,
            "stream_key": stream_key,
            "tool_call_id": tool_call_id,
            "message_id": "",
            "assistant_message_id": str(assistant_message.id),
            "index": index,
            "name": "",
        },
    )


async def emit_tool_call_delta(
    callbacks: LLMExecutionCallbacks,
    *,
    run: RunModel,
    thread: Thread,
    request_id: str,
    stream_key: str,
    tool_call_id: str,
    index: int | None,
    name: str,
    arguments_delta: str,
) -> None:
    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="tool_call:delta",
        data={
            "run_id": str(run.id),
            "request_id": request_id,
            "stream_key": stream_key,
            "tool_call_id": tool_call_id,
            "index": index,
            "name": name,
            "arguments_delta": arguments_delta,
        },
    )


async def emit_run_status(
    callbacks: LLMExecutionCallbacks,
    *,
    run: RunModel,
    thread: Thread,
    status: str,
    error: str | None = None,
) -> None:
    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="run:status",
        data={
            "run_id": str(run.id),
            "status": status,
            "error": error,
        },
    )


async def emit_terminal_events(
    callbacks: LLMExecutionCallbacks,
    *,
    db: Session,
    run: RunModel,
    thread: Thread,
    assistant_message: RunMessageModel,
    request_id: str,
    final_snapshot: FinalSnapshot,
    tool_call_summaries: list[dict[str, Any]],
) -> None:
    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="llm:response",
        data={
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "request_id": request_id,
            "provider": final_snapshot.provider,
            "model": final_snapshot.model,
        },
    )

    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="message:end",
        data={
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "request_id": request_id,
            "seq_in_thread": int(assistant_message.seq_in_thread),
            "data": assistant_message.data,
            "tool_calls": tool_call_summaries,
        },
    )

    await emit_run_status(
        callbacks,
        run=run,
        thread=thread,
        status=str(run.status),
        error=run.error,
    )

    await callbacks.sync_status_fn(
        db=db,
        run=run,
        thread=thread,
        error=run.error,
        emit_run_status=False,
    )

    await callbacks.emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="run:done",
        data={
            "run_id": str(run.id),
            "final_status": run.status,
        },
    )

    await tool_engine.propagate_child_terminal_state_to_parent(
        db,
        thread=thread,
        run=run,
        emit=callbacks.emit_fn,
    )

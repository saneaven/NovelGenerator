from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import RunMessageModel, RunModel, Thread
from .prompt_runtime.conversation_builder import build_from_runs
from .prompt_runtime.prompt_renderer import PromptRenderer


@dataclass(frozen=True)
class HistorySnapshot:
    system_prompt: str
    conversation: list[dict[str, Any]]
    prefill: str | None


def should_capture_or_reuse(
    db: Session,
    *,
    thread: Thread,
    previous_run: RunModel | None,
) -> str:
    if previous_run is None:
        return "capture"

    if thread.captured_from_run_id != previous_run.id:
        return "capture"

    last_msg = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.run_id == previous_run.id)
        .order_by(RunMessageModel.seq.desc())
        .first()
    )
    if last_msg is None:
        return "capture"

    if last_msg.role == "assistant":
        return "reuse"
    return "capture"


def capture_history(
    db: Session,
    *,
    thread: Thread,
    up_to_run: RunModel,
    renderer: PromptRenderer,
    task_type: str,
    prompt_name: str,
    project_data: dict[str, Any],
    extra_vars: dict[str, Any],
    language: str,
    tool_call_history_limit: int,
    thinking_history_limit: int,
) -> HistorySnapshot:
    past_runs = (
        db.query(RunModel)
        .filter(RunModel.thread_id == thread.id, RunModel.run_seq < up_to_run.run_seq)
        .order_by(RunModel.run_seq.asc())
        .all()
    )
    run_ids = [r.id for r in past_runs]

    system_prompt = renderer.render_system_prompt(task_type, prompt_name, project_data, extra_vars)
    conversation = build_from_runs(
        db,
        thread_id=thread.id,
        language=language,
        tool_call_history_limit=tool_call_history_limit,
        thinking_history_limit=thinking_history_limit,
        include_run_ids=run_ids,
    )
    prefill = renderer.render_prefill(task_type, prompt_name, project_data, extra_vars)

    thread.captured_history_system_prompt = system_prompt
    thread.captured_history_conversation_json = conversation
    thread.captured_history_prefill = prefill
    thread.captured_from_run_id = past_runs[-1].id if past_runs else None
    db.flush()

    return HistorySnapshot(system_prompt=system_prompt, conversation=conversation, prefill=prefill)


def reuse_history(thread: Thread) -> HistorySnapshot:
    system_prompt = str(thread.captured_history_system_prompt or "")
    conversation = thread.captured_history_conversation_json if isinstance(thread.captured_history_conversation_json, list) else []
    prefill = thread.captured_history_prefill if isinstance(thread.captured_history_prefill, str) and thread.captured_history_prefill else None
    return HistorySnapshot(system_prompt=system_prompt, conversation=conversation, prefill=prefill)

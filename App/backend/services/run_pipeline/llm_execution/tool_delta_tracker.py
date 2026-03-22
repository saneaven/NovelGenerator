from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ....models.db_models import RunMessageModel, RunModel, Thread
from . import events
from .contracts import LLMExecutionCallbacks


@dataclass
class ToolDeltaState:
    stream_key: str
    llm_call_id: str
    name: str
    raw_arguments: str
    index: int | None


def _tool_delta_id(tc_delta: dict[str, Any]) -> str | None:
    value = tc_delta.get("id")
    if isinstance(value, str) and value:
        return value
    return None


def _tool_delta_index(tc_delta: dict[str, Any]) -> int | None:
    value = tc_delta.get("index")
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return int(value)
    return None


def _resolve_stream_key(
    tc_delta: dict[str, Any],
    *,
    delta_state_by_key: dict[str, ToolDeltaState],
    state_key_by_index: dict[int, str],
    anonymous_counter: int,
) -> tuple[str, str, int | None, int]:
    call_id = _tool_delta_id(tc_delta)
    call_index = _tool_delta_index(tc_delta)

    if call_id is not None:
        id_key = f"id:{call_id}"
        if id_key in delta_state_by_key:
            if call_index is not None:
                state_key_by_index[call_index] = id_key
            return id_key, call_id, call_index, anonymous_counter

        if call_index is not None:
            mapped_key = state_key_by_index.get(call_index)
            if mapped_key is not None:
                existing_state = delta_state_by_key.get(mapped_key)
                if existing_state is not None:
                    if mapped_key.startswith("index:"):
                        delta_state_by_key.pop(mapped_key, None)
                        existing_state.stream_key = id_key
                        existing_state.llm_call_id = call_id
                        if existing_state.index is None:
                            existing_state.index = call_index
                        delta_state_by_key[id_key] = existing_state
                        state_key_by_index[call_index] = id_key
                    return id_key, call_id, call_index, anonymous_counter
                state_key_by_index.pop(call_index, None)

            state_key_by_index[call_index] = id_key
        return id_key, call_id, call_index, anonymous_counter

    if call_index is not None:
        mapped_key = state_key_by_index.get(call_index)
        if mapped_key is not None and mapped_key in delta_state_by_key:
            state = delta_state_by_key[mapped_key]
            return mapped_key, state.llm_call_id, call_index, anonymous_counter
        if mapped_key is not None:
            state_key_by_index.pop(call_index, None)

        stream_key = f"index:{call_index}"
        return stream_key, stream_key, call_index, anonymous_counter

    stream_key = f"anon:{anonymous_counter}"
    return stream_key, stream_key, None, anonymous_counter + 1


class ToolDeltaTracker:
    def __init__(
        self,
        *,
        callbacks: LLMExecutionCallbacks,
        run: RunModel,
        thread: Thread,
        assistant_message: RunMessageModel,
    ) -> None:
        self._callbacks = callbacks
        self._run = run
        self._thread = thread
        self._assistant_message = assistant_message
        self._delta_state_by_key: dict[str, ToolDeltaState] = {}
        self._state_key_by_index: dict[int, str] = {}
        self._anonymous_tool_call_counter = 0

    async def apply(self, tool_call_deltas: list[dict[str, Any]]) -> None:
        for tc_delta in tool_call_deltas:
            if not isinstance(tc_delta, dict):
                continue
            stream_key, llm_call_id, idx, self._anonymous_tool_call_counter = _resolve_stream_key(
                tc_delta,
                delta_state_by_key=self._delta_state_by_key,
                state_key_by_index=self._state_key_by_index,
                anonymous_counter=self._anonymous_tool_call_counter,
            )
            state = self._delta_state_by_key.get(stream_key)
            if state is None:
                state = ToolDeltaState(
                    stream_key=stream_key,
                    llm_call_id=llm_call_id,
                    name="",
                    raw_arguments="",
                    index=idx,
                )
                self._delta_state_by_key[stream_key] = state
                if idx is not None:
                    self._state_key_by_index[idx] = stream_key
                await events.emit_tool_call_start(
                    self._callbacks,
                    run=self._run,
                    thread=self._thread,
                    assistant_message=self._assistant_message,
                    stream_key=stream_key,
                    tool_call_id=llm_call_id,
                    index=idx,
                )

            state.stream_key = stream_key
            state.llm_call_id = llm_call_id
            if idx is not None:
                state.index = idx
                self._state_key_by_index[idx] = stream_key

            fn = tc_delta.get("function") if isinstance(tc_delta.get("function"), dict) else {}
            if isinstance(fn.get("name"), str):
                state.name = fn["name"]
            if isinstance(fn.get("arguments"), str):
                state.raw_arguments += fn["arguments"]
                await events.emit_tool_call_delta(
                    self._callbacks,
                    run=self._run,
                    thread=self._thread,
                    stream_key=stream_key,
                    tool_call_id=state.llm_call_id,
                    index=idx,
                    name=state.name,
                    arguments_delta=fn["arguments"],
                )

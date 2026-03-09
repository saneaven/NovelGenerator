from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .contracts import DeltaPayload, FinalSnapshot, FinalToolCall, MetaPayload, normalize_usage_dict
from .tool_call_arguments import parse_tool_call_arguments


@dataclass
class _ToolCallState:
    index: int
    id: str
    tool_name: str = ""
    raw_arguments: str = ""
    extra_content: Dict[str, Any] = field(default_factory=dict)


class FallbackSnapshotAssembler:
    def __init__(self, provider: str, model: str):
        self.provider = provider
        self.model = model
        self._content_parts: List[Dict[str, str]] = []
        self._reasoning_details: List[Dict[str, Any]] = []
        self._tool_calls_by_key: Dict[str, _ToolCallState] = {}
        self._tool_call_key_by_index: Dict[int, str] = {}
        self._tool_call_order: List[str] = []
        self._usage: Optional[Dict[str, int]] = None
        self._finish_reason: Optional[str] = None
        self._reasoning_tokens: Optional[int] = None
        self._anonymous_tool_counter = 0
        self._saw_content_delta = False

    def apply_delta(self, payload: DeltaPayload) -> None:
        if payload.content_delta is not None:
            self._saw_content_delta = True
        if payload.content_delta:
            self._append_content_part("content", payload.content_delta)

        if payload.thinking_delta:
            self._append_content_part("thinking", payload.thinking_delta)

        if payload.reasoning_detail_delta:
            self._reasoning_details.extend(payload.reasoning_detail_delta)

        for delta in payload.tool_call_deltas:
            self._apply_tool_call_delta(delta)

    def apply_meta(self, payload: MetaPayload) -> None:
        usage = normalize_usage_dict(payload.usage)
        if usage is not None:
            self._usage = usage
        if payload.finish_reason:
            self._finish_reason = payload.finish_reason
        if isinstance(payload.reasoning_tokens, int):
            self._reasoning_tokens = payload.reasoning_tokens

    def finalize_or_raise(self) -> FinalSnapshot:
        has_any_data = (
            bool(self._content_parts)
            or bool(self._reasoning_details)
            or bool(self._tool_call_order)
            or self._saw_content_delta
        )
        if not has_any_data:
            raise ValueError("Unable to assemble final snapshot: stream had no usable data")

        tool_calls: List[FinalToolCall] = []
        ordered_states = [self._tool_calls_by_key[key] for key in self._tool_call_order]
        ordered_states.sort(key=lambda state: state.index)

        for state in ordered_states:
            raw, args, parse_error = parse_tool_call_arguments(state.raw_arguments)

            tool_calls.append(
                FinalToolCall(
                    id=state.id,
                    tool_name=state.tool_name,
                    raw_arguments=raw,
                    arguments=args,
                    extra_content=(state.extra_content or None),
                    parse_error=parse_error,
                )
            )

        finish_reason = self._finish_reason
        if not finish_reason:
            finish_reason = "tool_calls" if tool_calls else "stop"

        return FinalSnapshot(
            provider=self.provider,
            model=self.model,
            finish_reason=finish_reason,
            content_parts=list(self._content_parts),
            tool_calls=tool_calls,
            reasoning_details=list(self._reasoning_details),
            usage=self._usage,
            reasoning_tokens=self._reasoning_tokens,
            final_source="reducer_fallback",
        )

    def _append_content_part(self, part_type: str, text: str) -> None:
        if not text:
            return
        if self._content_parts and self._content_parts[-1]["type"] == part_type:
            self._content_parts[-1]["text"] += text
            return
        self._content_parts.append({"type": part_type, "text": text})

    def _apply_tool_call_delta(self, delta: Dict[str, Any]) -> None:
        key, index = self._resolve_tool_call_key_and_index(delta)
        state = self._tool_calls_by_key.get(key)

        if state is None:
            state = _ToolCallState(
                index=index,
                id=str(delta.get("id") or f"tool_call_{index}"),
            )
            self._tool_calls_by_key[key] = state
            self._tool_call_order.append(key)

        if isinstance(delta.get("index"), int):
            self._tool_call_key_by_index[int(delta["index"])] = key

        if delta.get("id"):
            state.id = str(delta["id"])

        function = delta.get("function") if isinstance(delta.get("function"), dict) else {}
        if function.get("name"):
            state.tool_name = str(function.get("name"))
        if function.get("arguments"):
            state.raw_arguments += str(function.get("arguments"))

        extra_content = delta.get("extra_content")
        if isinstance(extra_content, dict):
            state.extra_content.update(extra_content)

    def _resolve_tool_call_key_and_index(self, delta: Dict[str, Any]) -> tuple[str, int]:
        call_index = delta.get("index")
        mapped_key = None
        if isinstance(call_index, int):
            mapped_key = self._tool_call_key_by_index.get(int(call_index))

        call_id = delta.get("id")
        if isinstance(call_id, str) and call_id:
            id_key = f"id:{call_id}"
            if mapped_key and mapped_key != id_key:
                migrated_index = self._migrate_tool_call_state(
                    from_key=mapped_key,
                    to_key=id_key,
                    call_id=call_id,
                )
                if migrated_index is not None:
                    self._tool_call_key_by_index[int(call_index)] = id_key
                    existing_id_state = self._tool_calls_by_key.get(id_key)
                    if existing_id_state is not None:
                        return id_key, existing_id_state.index
                    return id_key, migrated_index

            existing_id_state = self._tool_calls_by_key.get(id_key)
            if existing_id_state:
                if isinstance(call_index, int):
                    self._tool_call_key_by_index[int(call_index)] = id_key
                return id_key, existing_id_state.index

            if isinstance(call_index, int):
                self._tool_call_key_by_index[int(call_index)] = id_key
                return id_key, int(call_index)
            return f"id:{call_id}", len(self._tool_calls_by_key)

        if mapped_key:
            existing_state = self._tool_calls_by_key.get(mapped_key)
            if existing_state is not None:
                return mapped_key, existing_state.index

        if isinstance(call_index, int):
            key = f"index:{call_index}"
            self._tool_call_key_by_index[int(call_index)] = key
            return key, int(call_index)

        key = f"anonymous:{self._anonymous_tool_counter}"
        self._anonymous_tool_counter += 1
        return key, len(self._tool_calls_by_key)

    def _migrate_tool_call_state(self, *, from_key: str, to_key: str, call_id: str) -> int | None:
        if from_key == to_key:
            state = self._tool_calls_by_key.get(to_key)
            return state.index if state is not None else None

        source = self._tool_calls_by_key.pop(from_key, None)
        if source is None:
            return None

        target = self._tool_calls_by_key.get(to_key)
        if target is None:
            source.id = call_id
            self._tool_calls_by_key[to_key] = source
            self._tool_call_order = [to_key if key == from_key else key for key in self._tool_call_order]
            for index, key in list(self._tool_call_key_by_index.items()):
                if key == from_key:
                    self._tool_call_key_by_index[index] = to_key
            return source.index

        from_pos = self._tool_call_order.index(from_key) if from_key in self._tool_call_order else -1
        to_pos = self._tool_call_order.index(to_key) if to_key in self._tool_call_order else -1
        source_after_target = from_pos > to_pos >= 0

        if not target.tool_name and source.tool_name:
            target.tool_name = source.tool_name
        if source_after_target:
            target.raw_arguments += source.raw_arguments
        else:
            target.raw_arguments = source.raw_arguments + target.raw_arguments

        if source.extra_content:
            if source_after_target:
                target.extra_content.update(source.extra_content)
            else:
                merged_extra = dict(source.extra_content)
                merged_extra.update(target.extra_content)
                target.extra_content = merged_extra

        target.index = min(target.index, source.index)
        target.id = target.id or call_id
        self._tool_call_order = [key for key in self._tool_call_order if key != from_key]
        for index, key in list(self._tool_call_key_by_index.items()):
            if key == from_key:
                self._tool_call_key_by_index[index] = to_key
        return target.index

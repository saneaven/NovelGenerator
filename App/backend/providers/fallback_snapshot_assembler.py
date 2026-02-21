from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .contracts import DeltaPayload, FinalSnapshot, FinalToolCall, MetaPayload, normalize_usage_dict


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
        self._thinking_details: List[Dict[str, Any]] = []
        self._tool_calls_by_key: Dict[str, _ToolCallState] = {}
        self._tool_call_order: List[str] = []
        self._usage: Optional[Dict[str, int]] = None
        self._finish_reason: Optional[str] = None
        self._reasoning_tokens: Optional[int] = None
        self._anonymous_tool_counter = 0

    def apply_delta(self, payload: DeltaPayload) -> None:
        if payload.content_delta:
            self._append_content_part("content", payload.content_delta)

        if payload.thinking_delta:
            self._append_content_part("thinking", payload.thinking_delta)

        if payload.thinking_details_delta:
            self._thinking_details.extend(payload.thinking_details_delta)

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
            or bool(self._thinking_details)
            or bool(self._tool_call_order)
        )
        if not has_any_data:
            raise ValueError("Unable to assemble final snapshot: stream had no usable data")

        tool_calls: List[FinalToolCall] = []
        ordered_states = [self._tool_calls_by_key[key] for key in self._tool_call_order]
        ordered_states.sort(key=lambda state: state.index)

        for state in ordered_states:
            raw = state.raw_arguments.strip() or "{}"
            args: Dict[str, Any]
            parse_error: Optional[str] = None
            try:
                parsed = json.loads(raw)
                args = parsed if isinstance(parsed, dict) else {}
                if not isinstance(parsed, dict):
                    parse_error = "Tool arguments JSON is not an object"
            except Exception as exc:
                args = {}
                parse_error = str(exc)

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
            thinking_details=list(self._thinking_details),
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
        call_id = delta.get("id")
        if isinstance(call_id, str) and call_id:
            existing_index = self._tool_calls_by_key.get(f"id:{call_id}")
            if existing_index:
                return f"id:{call_id}", existing_index.index
            if isinstance(delta.get("index"), int):
                return f"id:{call_id}", int(delta["index"])
            return f"id:{call_id}", len(self._tool_calls_by_key)

        call_index = delta.get("index")
        if isinstance(call_index, int):
            return f"index:{call_index}", int(call_index)

        key = f"anonymous:{self._anonymous_tool_counter}"
        self._anonymous_tool_counter += 1
        return key, len(self._tool_calls_by_key)

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..contracts import FinalSnapshot, FinalToolCall, normalize_usage_dict
from .tool_call_arguments import parse_tool_call_arguments


def _to_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        dumped = value.model_dump(exclude_none=True)
        if isinstance(dumped, dict):
            return dumped
    if hasattr(value, "to_dict"):
        dumped = value.to_dict()
        if isinstance(dumped, dict):
            return dumped
    return {}


def _to_raw_dict(value: Any) -> Dict[str, Any]:
    """Like _to_dict but without exclude_none — preserves all fields."""
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        if isinstance(dumped, dict):
            return dumped
    if hasattr(value, "to_dict"):
        dumped = value.to_dict()
        if isinstance(dumped, dict):
            return dumped
    return {}


def _append_part(parts: List[Dict[str, str]], part_type: str, text: Optional[str]) -> None:
    if not isinstance(text, str) or not text:
        return
    if parts and parts[-1]["type"] == part_type:
        parts[-1]["text"] += text
    else:
        parts.append({"type": part_type, "text": text})


def _extract_openai_reasoning_item(item: Any) -> Dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    item_id = item.get("id")
    if not isinstance(item_id, str) or not item_id:
        return None
    out: Dict[str, Any] = {
        "id": item_id,
        "type": str(item.get("type") or "reasoning"),
    }
    encrypted_content = item.get("encrypted_content")
    if isinstance(encrypted_content, str) and encrypted_content:
        out["encrypted_content"] = encrypted_content
    summary = item.get("summary")
    if isinstance(summary, (str, list, dict)) and summary:
        out["summary"] = summary
    return out


def map_openai_response_to_snapshot(
    response_obj: Any,
    provider: str,
    model: str,
) -> FinalSnapshot:
    data = _to_dict(response_obj)
    raw_native_response = _to_raw_dict(response_obj)
    usage_raw = data.get("usage") or {}
    output_tokens_details = usage_raw.get("output_tokens_details") if isinstance(usage_raw.get("output_tokens_details"), dict) else {}
    reasoning_tokens = output_tokens_details.get("reasoning_tokens") if isinstance(output_tokens_details.get("reasoning_tokens"), (int, float)) else None
    usage = normalize_usage_dict(
        {
            "prompt_tokens": usage_raw.get("input_tokens", 0),
            "completion_tokens": usage_raw.get("output_tokens", 0),
            "total_tokens": usage_raw.get("total_tokens", 0),
        }
    )

    content_parts: List[Dict[str, str]] = []
    tool_calls: List[FinalToolCall] = []
    reasoning_details: List[Dict[str, Any]] = []

    output = data.get("output") or []
    for item in output:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "message":
            for chunk in item.get("content") or []:
                if not isinstance(chunk, dict):
                    continue
                chunk_type = chunk.get("type")
                if chunk_type in {"output_text", "text"}:
                    _append_part(content_parts, "content", chunk.get("text"))
                elif chunk_type in {"reasoning", "reasoning_text"}:
                    _append_part(content_parts, "thinking", chunk.get("text"))
            continue

        if item_type == "function_call":
            raw_text, args, parse_error = parse_tool_call_arguments(item.get("arguments"))
            tool_calls.append(
                FinalToolCall(
                    id=str(item.get("call_id") or item.get("id") or f"tool_call_{len(tool_calls)}"),
                    tool_name=str(item.get("name") or ""),
                    raw_arguments=raw_text,
                    arguments=args,
                    parse_error=parse_error,
                )
            )
            continue

        if item_type in {"reasoning", "reasoning_summary"}:
            text = item.get("summary") or item.get("text")
            if isinstance(text, str):
                _append_part(content_parts, "thinking", text)
            elif isinstance(text, list):
                for piece in text:
                    if isinstance(piece, dict) and isinstance(piece.get("text"), str):
                        _append_part(content_parts, "thinking", piece.get("text"))
            reasoning_item = _extract_openai_reasoning_item(item)
            if isinstance(reasoning_item, dict):
                reasoning_details.append(reasoning_item)

    if not content_parts:
        _append_part(content_parts, "content", data.get("output_text"))

    return FinalSnapshot(
        provider=provider,
        model=model,
        finish_reason=str(data.get("status") or "stop"),
        content_parts=content_parts,
        tool_calls=tool_calls,
        reasoning_details=reasoning_details,
        usage=usage,
        reasoning_tokens=(int(reasoning_tokens) if isinstance(reasoning_tokens, (int, float)) else None),
        final_source="native",
        raw_native_response=raw_native_response,
    )


def map_chat_completion_to_snapshot(
    completion_obj: Any,
    provider: str,
    model: str,
) -> FinalSnapshot:
    data = _to_dict(completion_obj)
    raw_native_response = _to_raw_dict(completion_obj)
    choices = data.get("choices") or []
    first_choice = choices[0] if choices else {}
    message = first_choice.get("message") or {}
    finish_reason = str(first_choice.get("finish_reason") or "stop")

    usage = normalize_usage_dict(data.get("usage"))
    usage_raw = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    completion_tokens_details = usage_raw.get("completion_tokens_details") if isinstance(usage_raw.get("completion_tokens_details"), dict) else {}
    reasoning_tokens = completion_tokens_details.get("reasoning_tokens") if isinstance(completion_tokens_details.get("reasoning_tokens"), (int, float)) else None

    content_parts: List[Dict[str, str]] = []
    tool_calls: List[FinalToolCall] = []
    reasoning_details: List[Dict[str, Any]] = []

    content = message.get("content")
    if isinstance(content, str):
        _append_part(content_parts, "content", content)
    elif isinstance(content, list):
        for part in content:
            if isinstance(part, dict):
                _append_part(content_parts, "content", part.get("text"))

    reasoning_text = message.get("reasoning")
    if not isinstance(reasoning_text, str) or not reasoning_text:
        reasoning_text = message.get("reasoning_content")
    if isinstance(reasoning_text, str) and reasoning_text:
        _append_part(content_parts, "thinking", reasoning_text)
        reasoning_details.append({"type": "reasoning.text", "text": reasoning_text})

    message_reasoning_details = message.get("reasoning_details")
    if isinstance(message_reasoning_details, list):
        for detail in message_reasoning_details:
            if not isinstance(detail, dict):
                continue
            reasoning_details.append(detail)
            text_value = detail.get("text")
            if isinstance(text_value, str) and text_value:
                _append_part(content_parts, "thinking", text_value)
            summary_value = detail.get("summary")
            if isinstance(summary_value, str) and summary_value:
                _append_part(content_parts, "thinking", summary_value)

    for tc in message.get("tool_calls") or []:
        if not isinstance(tc, dict):
            continue
        function = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        raw_text, args, parse_error = parse_tool_call_arguments(function.get("arguments"))
        tool_calls.append(
            FinalToolCall(
                id=str(tc.get("id") or f"tool_call_{len(tool_calls)}"),
                tool_name=str(function.get("name") or ""),
                raw_arguments=raw_text,
                arguments=args,
                extra_content=(tc.get("extra_content") if isinstance(tc.get("extra_content"), dict) else None),
                parse_error=parse_error,
            )
        )

    return FinalSnapshot(
        provider=provider,
        model=model,
        finish_reason=finish_reason,
        content_parts=content_parts,
        tool_calls=tool_calls,
        reasoning_details=reasoning_details,
        usage=usage,
        reasoning_tokens=(int(reasoning_tokens) if isinstance(reasoning_tokens, (int, float)) else None),
        final_source="native",
        raw_native_response=raw_native_response,
    )


def map_claude_message_to_snapshot(
    message_obj: Any,
    provider: str,
    model: str,
) -> FinalSnapshot:
    data = _to_dict(message_obj)
    raw_native_response = _to_raw_dict(message_obj)
    content_parts: List[Dict[str, str]] = []
    tool_calls: List[FinalToolCall] = []
    reasoning_details: List[Dict[str, Any]] = []

    for block in data.get("content") or []:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            _append_part(content_parts, "content", block.get("text"))
        elif block_type == "thinking":
            _append_part(content_parts, "thinking", block.get("thinking") or block.get("text"))
            reasoning_details.append(block)
        elif block_type == "tool_use":
            raw_text, args, parse_error = parse_tool_call_arguments(block.get("input"))
            tool_calls.append(
                FinalToolCall(
                    id=str(block.get("id") or f"tool_call_{len(tool_calls)}"),
                    tool_name=str(block.get("name") or ""),
                    raw_arguments=raw_text,
                    arguments=args,
                    parse_error=parse_error,
                )
            )

    usage_raw = data.get("usage") or {}
    usage = normalize_usage_dict(
        {
            "prompt_tokens": usage_raw.get("input_tokens", 0),
            "completion_tokens": usage_raw.get("output_tokens", 0),
            "total_tokens": (
                (usage_raw.get("input_tokens", 0) or 0)
                + (usage_raw.get("output_tokens", 0) or 0)
            ),
        }
    )

    return FinalSnapshot(
        provider=provider,
        model=model,
        finish_reason=str(data.get("stop_reason") or "stop"),
        content_parts=content_parts,
        tool_calls=tool_calls,
        reasoning_details=reasoning_details,
        usage=usage,
        final_source="native",
        raw_native_response=raw_native_response,
    )


def map_gemini_message_to_snapshot(
    message_obj: Any,
    provider: str,
    model: str,
    usage: Optional[Dict[str, int]] = None,
    reasoning_tokens: Optional[int] = None,
    finish_reason: Optional[str] = None,
) -> FinalSnapshot:
    data = _to_dict(message_obj)
    raw_native_response = _to_raw_dict(message_obj)
    content_parts: List[Dict[str, str]] = []
    tool_calls: List[FinalToolCall] = []
    reasoning_details: List[Dict[str, Any]] = []

    for part in data.get("parts") or []:
        part_data = _to_dict(part)
        if part_data.get("function_call"):
            fc = _to_dict(part_data.get("function_call"))
            raw_text, args, parse_error = parse_tool_call_arguments(fc.get("args"))
            tool_calls.append(
                FinalToolCall(
                    id=str(fc.get("id") or f"tool_call_{len(tool_calls)}"),
                    tool_name=str(fc.get("name") or ""),
                    raw_arguments=raw_text,
                    arguments=args,
                    parse_error=parse_error,
                )
            )
            continue

        text = part_data.get("text")
        is_thought = bool(part_data.get("thought"))
        if is_thought:
            _append_part(content_parts, "thinking", text if isinstance(text, str) else None)
            reasoning_details.append(part_data)
        else:
            _append_part(content_parts, "content", text if isinstance(text, str) else None)

    return FinalSnapshot(
        provider=provider,
        model=model,
        finish_reason=finish_reason or "stop",
        content_parts=content_parts,
        tool_calls=tool_calls,
        reasoning_details=reasoning_details,
        usage=normalize_usage_dict(usage),
        reasoning_tokens=(int(reasoning_tokens) if isinstance(reasoning_tokens, int) else None),
        final_source="native",
        raw_native_response=raw_native_response,
    )

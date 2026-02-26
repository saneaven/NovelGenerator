from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional


ProviderEventKind = Literal["delta", "meta", "final_native", "error"]
FinalSource = Literal["native", "reducer_fallback"]


def deep_merge_concat(target: Dict[str, Any], source: Dict[str, Any]) -> None:
    """Generic deep merge for streaming chunks. Strings concatenate, lists merge by index, dicts recurse."""
    for key, value in source.items():
        if value is None:
            continue
        if key not in target or target[key] is None:
            target[key] = copy.deepcopy(value)
        elif isinstance(value, str) and isinstance(target[key], str):
            if value != target[key]:
                target[key] += value
        elif isinstance(value, dict) and isinstance(target[key], dict):
            deep_merge_concat(target[key], value)
        elif isinstance(value, list) and isinstance(target[key], list):
            for i, item in enumerate(value):
                if i < len(target[key]) and isinstance(item, dict) and isinstance(target[key][i], dict):
                    deep_merge_concat(target[key][i], item)
                elif i >= len(target[key]):
                    target[key].append(copy.deepcopy(item))
        else:
            target[key] = copy.deepcopy(value)


@dataclass
class DeltaPayload:
    content_delta: Optional[str] = None
    thinking_delta: Optional[str] = None
    tool_call_deltas: List[Dict[str, Any]] = field(default_factory=list)
    reasoning_detail_delta: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class MetaPayload:
    usage: Optional[Dict[str, int]] = None
    finish_reason: Optional[str] = None
    reasoning_tokens: Optional[int] = None


@dataclass
class FinalToolCall:
    id: str
    tool_name: str
    raw_arguments: str
    arguments: Dict[str, Any]
    extra_content: Optional[Dict[str, Any]] = None
    parse_error: Optional[str] = None


@dataclass
class FinalSnapshot:
    provider: str
    model: str
    finish_reason: str
    content_parts: List[Dict[str, str]]
    tool_calls: List[FinalToolCall]
    reasoning_details: List[Dict[str, Any]]
    usage: Optional[Dict[str, int]] = None
    reasoning_tokens: Optional[int] = None
    final_source: FinalSource = "native"
    raw_native_response: Optional[Dict[str, Any]] = None


@dataclass
class ProviderErrorPayload:
    message: str
    status: Optional[int] = None


@dataclass
class ProviderEvent:
    kind: ProviderEventKind
    delta: Optional[DeltaPayload] = None
    meta: Optional[MetaPayload] = None
    final_native: Optional[FinalSnapshot] = None
    error: Optional[ProviderErrorPayload] = None
    raw_response: Optional[Dict[str, Any]] = None
    raw_request: Optional[Dict[str, Any]] = None


def normalize_usage_dict(raw: Optional[Dict[str, Any]]) -> Optional[Dict[str, int]]:
    if not isinstance(raw, dict):
        return None
    prompt_tokens = int(raw.get("prompt_tokens", 0) or 0)
    completion_tokens = int(raw.get("completion_tokens", 0) or 0)
    total_tokens = int(raw.get("total_tokens", prompt_tokens + completion_tokens) or 0)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }


def merge_meta_payload(left: Optional[MetaPayload], right: Optional[MetaPayload]) -> Optional[MetaPayload]:
    if left is None and right is None:
        return None
    if left is None:
        return MetaPayload(
            usage=normalize_usage_dict(right.usage) if right else None,
            finish_reason=(right.finish_reason if right else None),
            reasoning_tokens=(right.reasoning_tokens if right else None),
        )
    if right is None:
        return MetaPayload(
            usage=normalize_usage_dict(left.usage),
            finish_reason=left.finish_reason,
            reasoning_tokens=left.reasoning_tokens,
        )

    return MetaPayload(
        usage=normalize_usage_dict(right.usage) or normalize_usage_dict(left.usage),
        finish_reason=right.finish_reason or left.finish_reason,
        reasoning_tokens=(
            right.reasoning_tokens
            if isinstance(right.reasoning_tokens, int)
            else left.reasoning_tokens
        ),
    )


def patch_snapshot_with_meta(snapshot: FinalSnapshot, meta: Optional[MetaPayload]) -> FinalSnapshot:
    if meta is None:
        return snapshot
    if snapshot.usage is None and meta.usage is not None:
        snapshot.usage = normalize_usage_dict(meta.usage)
    if (not snapshot.finish_reason) and meta.finish_reason:
        snapshot.finish_reason = meta.finish_reason
    if snapshot.reasoning_tokens is None and isinstance(meta.reasoning_tokens, int):
        snapshot.reasoning_tokens = meta.reasoning_tokens
    return snapshot


def delta_payload_to_wire(seq: int, payload: DeltaPayload) -> Dict[str, Any]:
    return {
        "seq": seq,
        "contentDelta": payload.content_delta,
        "thinkingDelta": payload.thinking_delta,
        "toolCallDeltas": payload.tool_call_deltas,
        "reasoningDetailDelta": payload.reasoning_detail_delta,
    }


def final_tool_call_to_wire(tool_call: FinalToolCall) -> Dict[str, Any]:
    return {
        "id": tool_call.id,
        "tool_name": tool_call.tool_name,
        "rawArguments": tool_call.raw_arguments,
        "arguments": tool_call.arguments,
        "extra_content": tool_call.extra_content,
        "parseError": tool_call.parse_error,
    }


def extract_native_tool_calls_from_snapshot(snapshot: FinalSnapshot) -> FinalSnapshot:
    """Post-process a FinalSnapshot to extract <tool_call> XML from content.

    When native_tool_call mode is active, the final snapshot content may contain
    raw <tool_call> tags (e.g. from Claude's native SDK final message). This
    function parses them into proper FinalToolCall entries and cleans the content.

    If no <tool_call> tags are found, the snapshot is returned unchanged.
    """
    from .native_tool_calls_parser import NativeToolCallsStreamParser

    parser = NativeToolCallsStreamParser()
    new_content_parts: List[Dict[str, str]] = []
    all_deltas: List[Dict[str, Any]] = []

    for part in snapshot.content_parts:
        if part.get("type") != "content":
            new_content_parts.append(part)
            continue

        text = part.get("text", "")
        if not text:
            continue

        clean_text, deltas = parser.process_chunk(text)
        if clean_text:
            if new_content_parts and new_content_parts[-1].get("type") == "content":
                new_content_parts[-1]["text"] += clean_text
            else:
                new_content_parts.append({"type": "content", "text": clean_text})
        all_deltas.extend(deltas)

    tail_text, tail_deltas = parser.finalize()
    if tail_text:
        if new_content_parts and new_content_parts[-1].get("type") == "content":
            new_content_parts[-1]["text"] += tail_text
        else:
            new_content_parts.append({"type": "content", "text": tail_text})
    all_deltas.extend(tail_deltas)

    if not all_deltas:
        return snapshot

    # Group deltas by index to build complete tool calls
    tool_call_map: Dict[int, Dict[str, Any]] = {}
    for delta in all_deltas:
        idx = delta.get("index", 0)
        if idx not in tool_call_map:
            tool_call_map[idx] = {
                "id": delta.get("id", f"native-tool-call-{idx}"),
                "name": "",
                "arguments": "",
            }
        entry = tool_call_map[idx]
        if delta.get("id"):
            entry["id"] = delta["id"]
        fn = delta.get("function") if isinstance(delta.get("function"), dict) else {}
        if fn.get("name"):
            entry["name"] = fn["name"]
        if fn.get("arguments"):
            entry["arguments"] += fn["arguments"]

    new_tool_calls = list(snapshot.tool_calls)
    for idx in sorted(tool_call_map.keys()):
        entry = tool_call_map[idx]
        raw = entry["arguments"].strip() or "{}"
        args: Dict[str, Any] = {}
        parse_error: Optional[str] = None
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                args = parsed
            else:
                args = {}
                parse_error = "Tool arguments JSON is not an object"
        except Exception as exc:
            parse_error = str(exc)

        new_tool_calls.append(FinalToolCall(
            id=entry["id"],
            tool_name=entry["name"],
            raw_arguments=raw,
            arguments=args,
            parse_error=parse_error,
        ))

    finish_reason = "tool_calls" if new_tool_calls else snapshot.finish_reason

    return FinalSnapshot(
        provider=snapshot.provider,
        model=snapshot.model,
        finish_reason=finish_reason,
        content_parts=new_content_parts,
        tool_calls=new_tool_calls,
        reasoning_details=snapshot.reasoning_details,
        usage=snapshot.usage,
        reasoning_tokens=snapshot.reasoning_tokens,
        final_source=snapshot.final_source,
    )


def final_snapshot_to_wire(snapshot: FinalSnapshot) -> Dict[str, Any]:
    return {
        "provider": snapshot.provider,
        "model": snapshot.model,
        "finishReason": snapshot.finish_reason,
        "contentParts": snapshot.content_parts,
        "toolCalls": [final_tool_call_to_wire(tc) for tc in snapshot.tool_calls],
        "reasoningDetail": snapshot.reasoning_details,
        "usage": normalize_usage_dict(snapshot.usage),
        "reasoningTokens": snapshot.reasoning_tokens,
        "finalSource": snapshot.final_source,
    }

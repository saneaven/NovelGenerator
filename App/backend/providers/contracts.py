from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional


ProviderEventKind = Literal["delta", "meta", "final_native", "error"]
FinalSource = Literal["native", "reducer_fallback"]


@dataclass
class DeltaPayload:
    content_delta: Optional[str] = None
    thinking_delta: Optional[str] = None
    tool_call_deltas: List[Dict[str, Any]] = field(default_factory=list)
    thinking_details_delta: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class MetaPayload:
    usage: Optional[Dict[str, int]] = None
    finish_reason: Optional[str] = None


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
    thinking_details: List[Dict[str, Any]]
    usage: Optional[Dict[str, int]] = None
    final_source: FinalSource = "native"


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
        )
    if right is None:
        return MetaPayload(
            usage=normalize_usage_dict(left.usage),
            finish_reason=left.finish_reason,
        )

    return MetaPayload(
        usage=normalize_usage_dict(right.usage) or normalize_usage_dict(left.usage),
        finish_reason=right.finish_reason or left.finish_reason,
    )


def patch_snapshot_with_meta(snapshot: FinalSnapshot, meta: Optional[MetaPayload]) -> FinalSnapshot:
    if meta is None:
        return snapshot
    if snapshot.usage is None and meta.usage is not None:
        snapshot.usage = normalize_usage_dict(meta.usage)
    if (not snapshot.finish_reason) and meta.finish_reason:
        snapshot.finish_reason = meta.finish_reason
    return snapshot


def delta_payload_to_wire(seq: int, payload: DeltaPayload) -> Dict[str, Any]:
    return {
        "seq": seq,
        "contentDelta": payload.content_delta,
        "thinkingDelta": payload.thinking_delta,
        "toolCallDeltas": payload.tool_call_deltas,
        "thinkingDetailsDelta": payload.thinking_details_delta,
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


def final_snapshot_to_wire(snapshot: FinalSnapshot) -> Dict[str, Any]:
    return {
        "provider": snapshot.provider,
        "model": snapshot.model,
        "finishReason": snapshot.finish_reason,
        "contentParts": snapshot.content_parts,
        "toolCalls": [final_tool_call_to_wire(tc) for tc in snapshot.tool_calls],
        "thinkingDetails": snapshot.thinking_details,
        "usage": normalize_usage_dict(snapshot.usage),
        "finalSource": snapshot.final_source,
    }

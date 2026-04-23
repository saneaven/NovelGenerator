from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

from .parsing.tool_call_arguments import parse_tool_call_arguments


ProviderId = str
CapabilityName = Literal["llm", "embedding", "image"]


class _Missing:
    pass


MISSING = _Missing()


@dataclass(frozen=True)
class Condition:
    op: Literal["eq", "neq", "in", "not_in", "truthy", "falsy", "regex", "not_regex", "flag"]
    path: str | None = None
    value: Any = None
    flag: str | None = None
    pattern: str | None = None


@dataclass(frozen=True)
class UIHint:
    widget: Literal[
        "text",
        "password",
        "number",
        "select",
        "json",
        "toggle",
        "hidden",
        "template_select",
        "radio_cards",
        "slider",
    ] | None = None
    label_key: str | None = None
    placeholder_key: str | None = None
    help_key: str | None = None
    section: str | None = None
    order: int | None = None
    link_url: str | None = None
    link_label: str | None = None
    option_label_prefix: str | None = None


@dataclass(frozen=True)
class FieldSpec:
    kind: Literal["string", "number", "int", "bool", "enum", "object", "array", "literal"]
    required: bool = False
    default: Any = MISSING
    const: Any = MISSING
    options: tuple[Any, ...] | None = None
    disabled_options: tuple[Any, ...] | None = None
    when: tuple[Condition, ...] = ()
    disabled_when: tuple[Condition, ...] = ()
    ui: UIHint | None = None
    expose: bool = True
    min_value: float | None = None
    max_value: float | None = None
    step: float | None = None


@dataclass(frozen=True)
class ObjectSpec:
    fields: dict[str, "SchemaNode"]
    when: tuple[Condition, ...] = ()
    expose: bool = True
    group_toggle: str | None = None


SchemaNode = FieldSpec | ObjectSpec


@dataclass(frozen=True)
class DerivedFlag:
    name: str
    source_path: str
    resolver: Literal["regex", "presence", "bool"]
    pattern: str | None = None


@dataclass(frozen=True)
class RuntimeSpec:
    adapter: str
    server_only: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LLMVariantSpec:
    id: str
    runtime: RuntimeSpec
    task_config: ObjectSpec


@dataclass(frozen=True)
class LLMSpec:
    common_task_config: ObjectSpec
    variants: dict[str, LLMVariantSpec]
    variant_path: str | None = None
    default_variant: str | None = None
    derived_flags: tuple[DerivedFlag, ...] = ()
    supports_tools: bool = False
    supports_thinking: bool = False


@dataclass(frozen=True)
class EmbeddingSpec:
    config: ObjectSpec
    runtime: RuntimeSpec


@dataclass(frozen=True)
class ImageModelGeometrySpec:
    supported_aspect_ratios: tuple[str, ...]
    supported_resolutions: tuple[str, ...]
    default_aspect_ratio: str
    default_resolution: str
    resolution_mode: Literal["native_exact", "native_tier", "translated_fixed"]
    native_size_by_ratio: dict[str, str] | None = None
    supported_geometry_pairs: dict[str, tuple[str, ...]] | None = None


@dataclass(frozen=True)
class ImageModelDescriptor:
    id: str
    name: str
    prompt_type: Literal["natural", "tag_based"]
    supports_image_input: bool
    geometry: ImageModelGeometrySpec
    description: str | None = None
    canonical_slug: str | None = None
    owned_by: str | None = None
    icon_url: str | None = None
    tags: tuple[str, ...] | None = None
    category: str | None = None
    architecture: dict[str, Any] | None = None
    pricing: dict[str, Any] | None = None
    capabilities: dict[str, Any] | None = None
    supported_parameters: dict[str, Any] | None = None
    supports_mask_input: bool = False
    supports_multi_image_input: bool = False


@dataclass(frozen=True)
class ResolvedImageGeometry:
    model: str
    prompt_type: str
    supports_image_input: bool
    requested_aspect_ratio: str
    requested_image_size: str
    resolved_aspect_ratio: str
    resolved_image_size: str
    resolved_native_size: str


@dataclass(frozen=True)
class ImageSpec:
    runtime: RuntimeSpec
    prompt_type: Literal["natural", "tag_based"]
    supports_image_input: bool
    provider_settings: ObjectSpec | None = None
    settings_title_key: str | None = None
    settings_description_key: str | None = None
    models: tuple[ImageModelDescriptor, ...] = ()
    models_adapter: str | None = None
    catalog_cache_policy: Literal["static", "session", "none"] = "static"
    allow_missing_credentials_for_model_listing: bool = False


@dataclass(frozen=True)
class ProviderUI:
    display_name_key: str
    icon_key: str
    description_key: str | None = None
    llm_order: int | None = None
    embedding_order: int | None = None
    image_order: int | None = None
    model_browser_grouping_llm: Literal["flat", "openai_series", "gemini_family", "provider_family"] = "flat"
    model_browser_grouping_embedding: Literal["flat", "provider_family"] = "flat"
    llm_show_architecture: bool = False
    llm_show_pricing: bool = False
    llm_show_endpoints: bool = False
    embedding_show_architecture: bool = False
    embedding_show_pricing: bool = False
    embedding_show_endpoints: bool = False


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    ui: ProviderUI
    credentials: ObjectSpec
    llm: LLMSpec | None = None
    embedding: EmbeddingSpec | None = None
    image: ImageSpec | None = None


ProviderEventKind = Literal["delta", "meta", "final_native", "error"]
FinalSource = Literal["native", "reducer_fallback"]


def deep_merge_concat(target: Dict[str, Any], source: Dict[str, Any]) -> None:
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


def _tool_call_id(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def _tool_call_index(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return int(value)
    return None


def _merge_openai_tool_call(target_call: Dict[str, Any], source_call: Dict[str, Any]) -> None:
    source_index = _tool_call_index(source_call.get("index"))
    if source_index is not None:
        target_call["index"] = source_index

    source_id = _tool_call_id(source_call.get("id"))
    if source_id is not None:
        target_call["id"] = source_id

    source_type = source_call.get("type")
    if source_type is not None:
        target_call["type"] = copy.deepcopy(source_type)

    source_function = source_call.get("function")
    if isinstance(source_function, dict):
        target_function = target_call.get("function")
        if not isinstance(target_function, dict):
            target_function = {}
            target_call["function"] = target_function

        source_name = source_function.get("name")
        if isinstance(source_name, str) and source_name:
            target_function["name"] = source_name

        source_arguments = source_function.get("arguments")
        if isinstance(source_arguments, str) and source_arguments:
            existing_arguments = target_function.get("arguments")
            if isinstance(existing_arguments, str):
                target_function["arguments"] = existing_arguments + source_arguments
            else:
                target_function["arguments"] = source_arguments

        for key, value in source_function.items():
            if key in {"name", "arguments"} or value is None:
                continue
            target_function[key] = copy.deepcopy(value)

    for key, value in source_call.items():
        if key in {"index", "id", "type", "function"} or value is None:
            continue
        target_call[key] = copy.deepcopy(value)


def merge_openai_tool_call_deltas(target: List[Any], source: List[Any]) -> None:
    if not isinstance(target, list) or not isinstance(source, list):
        return

    by_id: Dict[str, Dict[str, Any]] = {}
    by_index: Dict[int, Dict[str, Any]] = {}

    def _register(call: Dict[str, Any]) -> None:
        call_id = _tool_call_id(call.get("id"))
        if call_id is not None:
            by_id[call_id] = call
        call_index = _tool_call_index(call.get("index"))
        if call_index is not None:
            by_index.setdefault(call_index, call)

    for existing in target:
        if isinstance(existing, dict):
            _register(existing)

    for incoming in source:
        if not isinstance(incoming, dict):
            target.append(copy.deepcopy(incoming))
            continue

        incoming_id = _tool_call_id(incoming.get("id"))
        incoming_index = _tool_call_index(incoming.get("index"))

        existing_call = None
        if incoming_id is not None:
            existing_call = by_id.get(incoming_id)
            if existing_call is None and incoming_index is not None:
                candidate = by_index.get(incoming_index)
                candidate_id = _tool_call_id(candidate.get("id")) if isinstance(candidate, dict) else None
                if candidate is not None and candidate_id is None:
                    existing_call = candidate
        elif incoming_index is not None:
            existing_call = by_index.get(incoming_index)

        if existing_call is None:
            copied = copy.deepcopy(incoming)
            target.append(copied)
            _register(copied)
            continue

        _merge_openai_tool_call(existing_call, incoming)
        _register(existing_call)

    indexed_calls: List[tuple[int, int, Any]] = []
    trailing_calls: List[tuple[int, Any]] = []
    for position, item in enumerate(target):
        if not isinstance(item, dict):
            trailing_calls.append((position, item))
            continue
        item_index = _tool_call_index(item.get("index"))
        if item_index is None:
            trailing_calls.append((position, item))
            continue
        indexed_calls.append((item_index, position, item))

    target[:] = [item for _, _, item in sorted(indexed_calls, key=lambda entry: (entry[0], entry[1]))]
    target.extend(item for _, item in trailing_calls)


def merge_openai_choice_delta(target: Dict[str, Any], source: Dict[str, Any]) -> None:
    if not isinstance(source, dict):
        return

    source_copy = copy.deepcopy(source)
    source_tool_calls = source_copy.pop("tool_calls", None)

    if isinstance(source_tool_calls, list):
        target_tool_calls = target.get("tool_calls")
        if isinstance(target_tool_calls, list):
            merge_openai_tool_call_deltas(target_tool_calls, source_tool_calls)
        else:
            target["tool_calls"] = copy.deepcopy(source_tool_calls)
    elif source_tool_calls is not None:
        target["tool_calls"] = copy.deepcopy(source_tool_calls)

    if source_copy:
        deep_merge_concat(target, source_copy)


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
    from .parsing.native_tool_calls_parser import NativeToolCallsStreamParser

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
        raw, args, parse_error = parse_tool_call_arguments(entry["arguments"])
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

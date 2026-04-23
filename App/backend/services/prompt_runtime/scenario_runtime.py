from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

from .template_renderer import TemplateRenderer


def _collapse_content_text(parts: Any) -> str:
    if not isinstance(parts, list):
        return ""
    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "content":
            continue
        text = part.get("text")
        if isinstance(text, str):
            chunks.append(text)
    return "".join(chunks)


def _non_text_content_parts(parts: Any) -> list[dict[str, Any]]:
    if not isinstance(parts, list):
        return []
    out: list[dict[str, Any]] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "content":
            continue
        out.append(dict(part))
    return out


def _normalize_index(i: int, n: int) -> int | None:
    if n <= 0:
        return None
    if i >= 0:
        norm = i
    else:
        norm = n + i
    if norm < 0 or norm >= n:
        return None
    return int(norm)


def _iter_blocks_in_order(blocks: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    items = [b for b in blocks if isinstance(b, dict)]
    # Server should normalize block_order, but be defensive.
    items.sort(key=lambda b: int(b.get("block_order") or 0))
    return items


def _group_by_run(source_items: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group source_items by run_id into run-level units.

    Consecutive items sharing the same non-None run_id form a single group.
    Items with run_id=None each become a standalone group.
    """
    runs: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_run_id: str | None = None

    for item in source_items:
        rid = item.get("message", {}).get("run_id")
        if rid is None:
            if current:
                runs.append(current)
                current = []
                current_run_id = None
            runs.append([item])
        elif rid != current_run_id:
            if current:
                runs.append(current)
            current = [item]
            current_run_id = rid
        else:
            current.append(item)

    if current:
        runs.append(current)
    return runs


def _shallow_copy_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _build_prefix_digest(system_prompt: str, conversation_prefix: list[dict[str, Any]]) -> str:
    payload = {
        "system_prompt": system_prompt,
        "conversation": conversation_prefix,
    }
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _prefix_label(rendered_message_count: int) -> str:
    if rendered_message_count <= 0:
        return "System prompt only"
    if rendered_message_count == 1:
        return "1 message"
    return f"{rendered_message_count} messages"


def _block_order_of(block: dict[str, Any]) -> int:
    return int(block.get("block_order") or 0)


def _snapshot_key(item: dict[str, Any], key: str) -> Any:
    if key in item:
        return item.get(key)
    # Snapshot metadata uses camelCase while rendered messages retain provider-facing keys.
    camel = key.split("_")[0] + "".join(part[:1].upper() + part[1:] for part in key.split("_")[1:])
    return item.get(camel)


def _last_message_metadata(prefix_conversation: list[dict[str, Any]]) -> tuple[int | None, str | None]:
    last_message = prefix_conversation[-1] if prefix_conversation else None
    last_seq_in_thread = (
        int(last_message.get("seq_in_thread"))
        if isinstance(last_message, dict) and isinstance(last_message.get("seq_in_thread"), int)
        else None
    )
    last_role = (
        str(last_message.get("role") or "")
        if isinstance(last_message, dict) and isinstance(last_message.get("role"), str)
        else ("system" if not prefix_conversation else None)
    )
    return last_seq_in_thread, last_role


def _message_identity(message: dict[str, Any]) -> str:
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"), sort_keys=True, default=str)


def cache_boundaries_from_snapshot(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    system_prompt = str(snapshot.get("systemPrompt") or "")
    raw_segments = snapshot.get("segments")
    segments = [item for item in raw_segments if isinstance(item, dict)] if isinstance(raw_segments, list) else []
    raw_cache_points = snapshot.get("cachePoints")
    cache_points = [item for item in raw_cache_points if isinstance(item, dict)] if isinstance(raw_cache_points, list) else []

    boundaries: list[dict[str, Any]] = []
    for cache_point in sorted(cache_points, key=lambda item: int(_snapshot_key(item, "block_order") or 0)):
        checkpoint_id = str(_snapshot_key(cache_point, "checkpoint_id") or _snapshot_key(cache_point, "block_id") or "")
        after_block_order_raw = _snapshot_key(cache_point, "after_block_order")
        try:
            after_block_order = int(after_block_order_raw) if after_block_order_raw is not None else None
        except (TypeError, ValueError):
            after_block_order = None

        prefix_conversation: list[dict[str, Any]] = []
        if after_block_order is not None:
            for segment in segments:
                try:
                    segment_order = int(_snapshot_key(segment, "block_order") or 0)
                except (TypeError, ValueError):
                    continue
                if segment_order > after_block_order:
                    continue
                messages = segment.get("messages")
                if isinstance(messages, list):
                    prefix_conversation.extend(dict(message) for message in messages if isinstance(message, dict))

        last_seq_in_thread, last_role = _last_message_metadata(prefix_conversation)
        boundaries.append(
            {
                "checkpoint_id": checkpoint_id,
                "block_id": str(_snapshot_key(cache_point, "block_id") or checkpoint_id),
                "block_order": int(_snapshot_key(cache_point, "block_order") or 0),
                "after_block_order": after_block_order,
                "rendered_message_count": len(prefix_conversation),
                "last_seq_in_thread": last_seq_in_thread,
                "last_role": last_role,
                "prefix_label": _prefix_label(len(prefix_conversation)),
                "prefix_digest_raw": _build_prefix_digest(system_prompt, prefix_conversation),
            }
        )

    seen_prefixes: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for boundary in boundaries:
        prefix_digest = str(boundary.get("prefix_digest_raw") or "")
        if not prefix_digest:
            continue
        if prefix_digest in seen_prefixes:
            boundary = dict(boundary)
            boundary["duplicate_prefix"] = True
        else:
            seen_prefixes.add(prefix_digest)
        deduped.append(boundary)
    return deduped


def flatten_prompt_snapshot(snapshot: dict[str, Any]) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    system_prompt = str(snapshot.get("systemPrompt") or "")
    raw_segments = snapshot.get("segments")
    segments = [item for item in raw_segments if isinstance(item, dict)] if isinstance(raw_segments, list) else []
    conversation: list[dict[str, Any]] = []
    for segment in segments:
        messages = segment.get("messages")
        if isinstance(messages, list):
            conversation.extend(dict(message) for message in messages if isinstance(message, dict))
    return system_prompt, conversation, cache_boundaries_from_snapshot(snapshot)


def extend_prompt_snapshot_with_resume_tail(
    snapshot: dict[str, Any],
    *,
    tail_messages: list[dict[str, Any]],
) -> dict[str, Any]:
    patched = dict(snapshot)
    raw_segments = snapshot.get("segments")
    segments = [dict(item) for item in raw_segments if isinstance(item, dict)] if isinstance(raw_segments, list) else []
    open_segment_index = next((idx for idx in range(len(segments) - 1, -1, -1) if bool(segments[idx].get("open"))), None)
    if open_segment_index is None:
        patched["segments"] = segments
        return patched

    segment = dict(segments[open_segment_index])
    raw_messages = segment.get("messages")
    messages = [dict(item) for item in raw_messages if isinstance(item, dict)] if isinstance(raw_messages, list) else []
    existing_messages = {_message_identity(item) for item in messages}

    for item in tail_messages:
        if not isinstance(item, dict):
            continue
        if item.get("role") == "user":
            continue
        identity = _message_identity(item)
        if identity in existing_messages:
            continue
        messages.append(dict(item))
        existing_messages.add(identity)

    segment["messages"] = messages
    segments[open_segment_index] = segment
    patched["segments"] = segments
    return patched


def _patched_template_data(*, template_data: dict[str, Any], input_key: str, source_text: str) -> dict[str, Any]:
    root = _shallow_copy_dict(template_data)
    inp = _shallow_copy_dict(root.get("input"))
    inp[input_key] = source_text
    root["input"] = inp
    return root


def _assistant_has_structured_payload(message: dict[str, Any], attached_tool_results: Any) -> bool:
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        return True

    reasoning_detail = message.get("reasoning_detail")
    if isinstance(reasoning_detail, dict) and reasoning_detail:
        return True

    return isinstance(attached_tool_results, list) and any(isinstance(item, dict) for item in attached_tool_results)


def assemble_scenario_snapshot(
    *,
    template_renderer: TemplateRenderer,
    task_type: str,
    system_template: str,
    blocks: list[dict[str, Any]],
    source_conversation: list[dict[str, Any]],
    template_data: dict[str, Any],
    current_run_id: str | None = None,
) -> dict[str, Any]:
    """Assemble a scenario into a block-segment prompt snapshot.

    - source_conversation messages are grouped into runs by run_id.
    - rangeMapping start_index/end_index refer to run positions (not individual messages).
    - Within each run, user_template / assistant_template are applied per message.
    - tool_results are attached to the preceding assistant turn and are appended only when that assistant is emitted.
    - Overlapping rangeMapping blocks resolve by owner overwrite (later blocks win).
    """
    blocks_in_order = _iter_blocks_in_order(blocks)

    # 1) Build source sequence (user/assistant only) and attach tool_results to assistants.
    source_items: list[dict[str, Any]] = []
    idx = 0
    while idx < len(source_conversation):
        msg = source_conversation[idx]
        role = msg.get("role") if isinstance(msg, dict) else None
        if role not in {"user", "assistant"}:
            idx += 1
            continue

        entry: dict[str, Any] = {"message": msg, "tool_results": []}
        if role == "assistant":
            attached: list[dict[str, Any]] = []
            j = idx + 1
            while j < len(source_conversation):
                nxt = source_conversation[j]
                if not isinstance(nxt, dict) or nxt.get("role") != "tool_results":
                    break
                attached.append(nxt)
                j += 1
            entry["tool_results"] = attached
            idx = j
        else:
            idx += 1

        source_items.append(entry)

    # 1.5) Group source_items by run_id into run-level units.
    source_runs = _group_by_run(source_items)
    n_sources = len(source_runs)

    # 2) Compute owner map — indices now refer to runs (later range blocks win).
    owner: dict[int, int] = {}
    for block in blocks_in_order:
        if not bool(block.get("enabled", True)):
            continue
        if block.get("type") != "rangeMapping":
            continue
        mapping = block.get("rangeMapping")
        if not isinstance(mapping, dict):
            continue
        try:
            start_i = int(mapping.get("start_index"))
            end_i = int(mapping.get("end_index"))
        except (TypeError, ValueError):
            continue

        start_norm = _normalize_index(start_i, n_sources)
        end_norm = _normalize_index(end_i, n_sources)
        if start_norm is None or end_norm is None:
            continue
        if start_norm > end_norm:
            continue

        block_order = int(block.get("block_order") or 0)
        for si in range(start_norm, end_norm + 1):
            owner[si] = block_order

    # 3) Render system prompt.
    rendered_system_prompt = template_renderer.render_text(system_template or "", template_data).strip()

    rendered_conversation: list[dict[str, Any]] = []
    segments: list[dict[str, Any]] = []
    cache_points: list[dict[str, Any]] = []
    last_rendered_block_order: int | None = None
    # Patch rules differ for subAgent.
    is_sub_agent = str(task_type or "") == "subAgent"
    user_input_key = "agentMessage" if is_sub_agent else "userMessage"
    assistant_input_key = "subAgentMessage" if is_sub_agent else "agentMessage"

    for block in blocks_in_order:
        if not bool(block.get("enabled", True)):
            continue

        btype = block.get("type")

        if btype == "staticPrompt":
            static = block.get("staticPrompt")
            if not isinstance(static, dict):
                continue
            role = static.get("role")
            template_text = static.get("template")
            if not isinstance(role, str) or role not in {"user", "assistant"}:
                continue
            if not isinstance(template_text, str):
                template_text = ""

            rendered = template_renderer.render_text(template_text, template_data).strip()
            if not rendered:
                continue

            block_order = _block_order_of(block)
            message = {
                "role": role,
                "content_parts": [{"type": "content", "text": rendered}],
            }
            segments.append(
                {
                    "blockId": str(block.get("id") or ""),
                    "blockOrder": block_order,
                    "type": "staticPrompt",
                    "messages": [message],
                    "open": False,
                }
            )
            rendered_conversation.append(message)
            last_rendered_block_order = block_order
            continue

        if btype == "cachePoint":
            checkpoint_id = str(block.get("id") or "")
            cache_points.append(
                {
                    "checkpointId": checkpoint_id,
                    "blockId": checkpoint_id,
                    "blockOrder": _block_order_of(block),
                    "afterBlockOrder": last_rendered_block_order,
                }
            )
            continue

        if btype != "rangeMapping":
            continue

        mapping = block.get("rangeMapping")
        if not isinstance(mapping, dict):
            continue

        try:
            start_i = int(mapping.get("start_index"))
            end_i = int(mapping.get("end_index"))
        except (TypeError, ValueError):
            continue

        start_norm = _normalize_index(start_i, n_sources)
        end_norm = _normalize_index(end_i, n_sources)
        if start_norm is None or end_norm is None:
            continue
        if start_norm > end_norm:
            continue

        block_order = _block_order_of(block)
        user_template = mapping.get("user_template") if isinstance(mapping.get("user_template"), str) else ""
        assistant_template = (
            mapping.get("assistant_template") if isinstance(mapping.get("assistant_template"), str) else ""
        )
        block_messages: list[dict[str, Any]] = []

        for run_index in range(start_norm, end_norm + 1):
            if owner.get(run_index) != block_order:
                continue

            for src_entry in source_runs[run_index]:
                src_msg = src_entry.get("message")
                if not isinstance(src_msg, dict):
                    continue
                src_role = src_msg.get("role")
                if src_role not in {"user", "assistant"}:
                    continue

                src_text = _collapse_content_text(src_msg.get("content_parts"))

                if src_role == "user":
                    extra_parts = _non_text_content_parts(src_msg.get("content_parts"))
                    patched = _patched_template_data(
                        template_data=template_data,
                        input_key=user_input_key,
                        source_text=src_text,
                    )
                    rendered = template_renderer.render_text(user_template, patched).strip()
                    if not rendered and not extra_parts:
                        continue
                    rendered_parts = ([{"type": "content", "text": rendered}] if rendered else []) + extra_parts
                    out_msg: dict[str, Any] = {
                        "role": "user",
                        "content_parts": rendered_parts,
                    }
                    run_id = src_msg.get("run_id")
                    if isinstance(run_id, str) and run_id:
                        out_msg["run_id"] = run_id
                    seq_in_thread = src_msg.get("seq_in_thread")
                    if isinstance(seq_in_thread, int):
                        out_msg["seq_in_thread"] = seq_in_thread
                    block_messages.append(out_msg)
                    continue

                patched = _patched_template_data(
                    template_data=template_data,
                    input_key=assistant_input_key,
                    source_text=src_text,
                )
                rendered = template_renderer.render_text(assistant_template, patched).strip()
                attached = src_entry.get("tool_results")
                if not rendered and not _assistant_has_structured_payload(src_msg, attached):
                    continue

                out_msg = {
                    "role": "assistant",
                    "content_parts": [{"type": "content", "text": rendered}] if rendered else [],
                }

                run_id = src_msg.get("run_id")
                if isinstance(run_id, str) and run_id:
                    out_msg["run_id"] = run_id
                seq_in_thread = src_msg.get("seq_in_thread")
                if isinstance(seq_in_thread, int):
                    out_msg["seq_in_thread"] = seq_in_thread

                tool_calls = src_msg.get("tool_calls")
                if isinstance(tool_calls, list) and tool_calls:
                    out_msg["tool_calls"] = tool_calls

                reasoning_detail = src_msg.get("reasoning_detail")
                if isinstance(reasoning_detail, dict) and reasoning_detail:
                    out_msg["reasoning_detail"] = reasoning_detail

                block_messages.append(out_msg)

                if isinstance(attached, list) and attached:
                    for tool_msg in attached:
                        if isinstance(tool_msg, dict):
                            block_messages.append(dict(tool_msg))

        if block_messages:
            rendered_conversation.extend(block_messages)
            is_open = bool(
                current_run_id
                and any(str(message.get("run_id") or "") == str(current_run_id) for message in block_messages)
            )
            segments.append(
                {
                    "blockId": str(block.get("id") or ""),
                    "blockOrder": block_order,
                    "type": "rangeMapping",
                    "messages": block_messages,
                    "open": is_open,
                }
            )
            last_rendered_block_order = block_order

    return {
        "version": 1,
        "systemPrompt": rendered_system_prompt,
        "segments": segments,
        "cachePoints": cache_points,
    }


def assemble_scenario_with_cache_plan(
    *,
    template_renderer: TemplateRenderer,
    task_type: str,
    system_template: str,
    blocks: list[dict[str, Any]],
    source_conversation: list[dict[str, Any]],
    template_data: dict[str, Any],
    current_run_id: str | None = None,
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    snapshot = assemble_scenario_snapshot(
        template_renderer=template_renderer,
        task_type=task_type,
        system_template=system_template,
        blocks=blocks,
        source_conversation=source_conversation,
        template_data=template_data,
        current_run_id=current_run_id,
    )
    return flatten_prompt_snapshot(snapshot)


def assemble_scenario(
    *,
    template_renderer: TemplateRenderer,
    task_type: str,
    system_template: str,
    blocks: list[dict[str, Any]],
    source_conversation: list[dict[str, Any]],
    template_data: dict[str, Any],
) -> tuple[str, list[dict[str, Any]]]:
    rendered_system_prompt, rendered_conversation, _cache_plan = assemble_scenario_with_cache_plan(
        template_renderer=template_renderer,
        task_type=task_type,
        system_template=system_template,
        blocks=blocks,
        source_conversation=source_conversation,
        template_data=template_data,
    )
    return rendered_system_prompt, rendered_conversation

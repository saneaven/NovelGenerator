from __future__ import annotations

import copy
from typing import Any


def get_completed_runs(messages: list[dict[str, Any]], current_run_id: str) -> list[str]:
    order: list[str] = []
    has_assistant: set[str] = set()

    for message in messages:
        run_id = message.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            continue
        if run_id not in order:
            order.append(run_id)
        if message.get("role") == "assistant":
            has_assistant.add(run_id)

    return [run_id for run_id in order if run_id in has_assistant and run_id != current_run_id]


def pick_runs(run_ids: list[str], limit: int) -> set[str]:
    if limit < 0:
        return set(run_ids)
    if limit == 0:
        return set()
    return set(run_ids[-limit:])


def _output_items_only_reasoning_detail(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    if raw.get("type") != "openai":
        return None
    data = raw.get("data")
    if not isinstance(data, dict):
        return None
    if "output_items" not in data:
        return None
    output_items = data["output_items"]

    meta_raw = raw.get("meta")
    meta: dict[str, Any] = {}
    if isinstance(meta_raw, dict):
        provider = meta_raw.get("provider")
        if isinstance(provider, str) and provider:
            meta["provider"] = provider

    return {
        "type": raw.get("type"),
        "meta": meta,
        "data": {"output_items": copy.deepcopy(output_items)},
        "token_count": 0,
    }


def _without_output_items(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    if raw.get("type") != "openai":
        return raw
    data_raw = raw.get("data")
    if not isinstance(data_raw, dict) or "output_items" not in data_raw:
        return raw

    detail = dict(raw)
    data = dict(data_raw)
    data.pop("output_items", None)
    detail["data"] = data
    return detail


def filter_history_by_run(
    messages: list[dict[str, Any]],
    current_run_id: str,
    tool_limit: int,
    thinking_limit: int,
) -> list[dict[str, Any]]:
    completed_runs = get_completed_runs(messages, current_run_id)
    tool_runs = pick_runs(completed_runs, tool_limit)
    reasoning_runs = pick_runs(completed_runs, thinking_limit)

    result: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        run_id = message.get("run_id")
        out = dict(message)

        # Messages without run_id are static prompt/system inserts. Keep as-is.
        if not isinstance(run_id, str) or not run_id:
            result.append(out)
            continue

        # Current run history must always pass through unchanged.
        # Limits apply only to previous completed runs.
        if run_id == current_run_id:
            result.append(out)
            continue

        if role == "assistant":
            if run_id not in reasoning_runs:
                parts = out.get("content_parts")
                if isinstance(parts, list):
                    out["content_parts"] = [
                        part for part in parts
                        if isinstance(part, dict) and part.get("type") != "thinking"
                    ]
                output_items_detail = (
                    _output_items_only_reasoning_detail(out.get("reasoning_detail"))
                    if run_id in tool_runs
                    else None
                )
                if output_items_detail is not None:
                    out["reasoning_detail"] = output_items_detail
                else:
                    out.pop("reasoning_detail", None)

            if run_id not in tool_runs:
                out.pop("tool_calls", None)
                reasoning_detail = _without_output_items(out.get("reasoning_detail"))
                if reasoning_detail is not None:
                    out["reasoning_detail"] = reasoning_detail

        if role == "tool_results" and run_id not in tool_runs:
            continue

        result.append(out)

    return result

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunToolCallModel


def _resolve_lang_entry(data: dict[str, Any], language: str) -> dict[str, Any]:
    if isinstance(data.get(language), dict):
        return data[language]
    if isinstance(data.get("_final"), dict):
        return data["_final"]
    for value in data.values():
        if isinstance(value, dict):
            return value
    return {"contentParts": []}


def _normalize_content_parts(entry: dict[str, Any]) -> list[dict[str, str]]:
    parts = entry.get("contentParts") if isinstance(entry, dict) else []
    if not isinstance(parts, list):
        return []

    out: list[dict[str, str]] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        ptype = str(part.get("type") or "content")
        text = part.get("text")
        if not isinstance(text, str):
            continue
        out.append({"type": ptype, "text": text})
    return out


def _tool_result_from_message(message: RunMessageModel, entry: dict[str, Any]) -> dict[str, Any] | None:
    tool_result = entry.get("toolResult") if isinstance(entry, dict) else None
    if isinstance(tool_result, dict):
        tid = tool_result.get("tool_call_id")
        tname = tool_result.get("tool_name")
        content = tool_result.get("content")
        if isinstance(tid, str) and isinstance(tname, str) and isinstance(content, str):
            return {
                "tool_call_id": tid,
                "tool_name": tname,
                "content": content,
            }

    parts = _normalize_content_parts(entry)
    joined = "".join(part["text"] for part in parts if part["type"] == "content")
    if not joined.strip():
        return None

    return {
        "tool_call_id": f"tool-result-{message.id}",
        "tool_name": "tool_result",
        "content": joined,
    }


def build_from_runs(
    db: Session,
    thread_id: UUID,
    language: str,
    tool_call_history_limit: int,
    thinking_history_limit: int,
    include_run_ids: list[UUID] | None = None,
) -> list[dict[str, Any]]:
    q = db.query(RunMessageModel).filter(RunMessageModel.thread_id == thread_id)
    if include_run_ids:
        q = q.filter(RunMessageModel.run_id.in_(include_run_ids))

    rows = q.order_by(RunMessageModel.seq_in_thread.asc(), RunMessageModel.created_at.asc()).all()
    if not rows:
        return []

    # Tool calls are looked up by assistant_message_id and attached to assistant turns.
    assistant_ids = [row.id for row in rows if row.role == "assistant"]
    tool_calls_by_assistant: dict[UUID, list[RunToolCallModel]] = {}
    if assistant_ids:
        tool_rows = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.assistant_message_id.in_(assistant_ids))
            .order_by(RunToolCallModel.call_seq.asc())
            .all()
        )
        for tool in tool_rows:
            if tool.assistant_message_id is None:
                continue
            tool_calls_by_assistant.setdefault(tool.assistant_message_id, []).append(tool)

    assistant_order = [row.id for row in rows if row.role == "assistant"]
    if tool_call_history_limit >= 0:
        kept_assistant_for_tools = set(assistant_order[-tool_call_history_limit:]) if tool_call_history_limit > 0 else set()
    else:
        kept_assistant_for_tools = set(assistant_order)

    if thinking_history_limit >= 0:
        kept_assistant_for_thinking = set(assistant_order[-thinking_history_limit:]) if thinking_history_limit > 0 else set()
    else:
        kept_assistant_for_thinking = set(assistant_order)

    conversation: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row.data, dict):
            continue
        entry = _resolve_lang_entry(row.data, language)

        if row.role in {"system", "user", "assistant"}:
            content_parts = _normalize_content_parts(entry)
            if row.role == "assistant" and row.id not in kept_assistant_for_thinking:
                content_parts = [part for part in content_parts if part.get("type") != "thinking"]

            msg: dict[str, Any] = {
                "role": row.role,
                "content_parts": content_parts,
            }

            if row.role == "assistant" and row.id in kept_assistant_for_tools:
                tool_calls = []
                for tool in tool_calls_by_assistant.get(row.id, []):
                    tool_calls.append(
                        {
                            "id": tool.llm_call_id,
                            "type": "function",
                            "function": {
                                "name": tool.tool_name,
                                "arguments": json.dumps(tool.arguments if isinstance(tool.arguments, dict) else {}, ensure_ascii=False),
                            },
                        }
                    )
                if tool_calls:
                    msg["tool_calls"] = tool_calls

            conversation.append(msg)
            continue

        if row.role == "tool_result":
            payload = _tool_result_from_message(row, entry)
            if payload is None:
                continue
            conversation.append(
                {
                    "role": "tool_results",
                    "content_parts": [],
                    "tool_results": [payload],
                }
            )

    return conversation

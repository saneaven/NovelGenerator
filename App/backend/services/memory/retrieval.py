from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import desc
from sqlalchemy.orm import Session

from ...models.memory_models import MessageMemorySummary
from ..memory_service import search_thread_memory


def _coerce_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_tool_call_id(field_path: str) -> str | None:
    if not field_path.startswith("tool_calls/"):
        return None
    suffix = field_path[len("tool_calls/") :].strip("/")
    if not suffix:
        return None
    return suffix.split("/", 1)[0]


def _build_queries(*, last_user_text: str, last_assistant_text: str) -> list[str]:
    out: list[str] = []
    for text in (last_user_text, last_assistant_text):
        value = str(text or "").strip()
        if value:
            out.append(value)
    return out


def _build_memory_summary_list(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
    limit: int = 5,
) -> list[str]:
    rows = (
        db.query(MessageMemorySummary)
        .filter(
            MessageMemorySummary.user_id == user_id,
            MessageMemorySummary.project_id == project_id,
            MessageMemorySummary.thread_id == thread_id,
            MessageMemorySummary.language == language,
        )
        .order_by(
            desc(MessageMemorySummary.to_seq_in_thread),
            desc(MessageMemorySummary.created_at),
        )
        .limit(limit)
        .all()
    )
    if not rows:
        rows = (
            db.query(MessageMemorySummary)
            .filter(
                MessageMemorySummary.user_id == user_id,
                MessageMemorySummary.project_id == project_id,
                MessageMemorySummary.thread_id == thread_id,
            )
            .order_by(
                desc(MessageMemorySummary.to_seq_in_thread),
                desc(MessageMemorySummary.created_at),
            )
            .limit(limit)
            .all()
        )

    summaries: list[str] = []
    for row in reversed(rows):
        text = str(getattr(row, "summary_text", "") or "").strip()
        if text:
            summaries.append(text)
    return summaries


async def build_memory_data(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
    last_user_text: str,
    last_assistant_text: str,
) -> dict[str, Any]:
    summaries = _build_memory_summary_list(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
    )

    history_rows: list[dict[str, Any]] = []
    queries = _build_queries(last_user_text=last_user_text, last_assistant_text=last_assistant_text)
    if queries:
        memory_items = await search_thread_memory(
            db,
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            language=language,
            queries=queries,
        )
        for item in memory_items[:20]:
            snippet = str(item.get("content") or "").strip()
            if not snippet:
                continue

            field_path = str(item.get("field_path") or "")
            tool_call_id = _extract_tool_call_id(field_path)
            history_row: dict[str, Any] = {
                "messageId": str(item.get("message_id") or ""),
                "role": str(item.get("role") or "assistant"),
                "matchedSnippet": snippet,
                "distance": _coerce_float(item.get("distance")),
                "match": {
                    "kind": "tool_call" if tool_call_id else "content",
                    "fieldPath": field_path,
                    "chunkIndex": _coerce_int(item.get("chunk_index")),
                },
            }
            if tool_call_id:
                history_row["toolCall"] = {
                    "id": tool_call_id,
                    "name": "",
                    "status": "",
                    "result": snippet,
                }
            history_rows.append(history_row)

    return {
        "summaries": summaries,
        "historyChats": history_rows,
    }

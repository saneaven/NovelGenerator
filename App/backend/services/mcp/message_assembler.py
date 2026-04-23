from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..prompt_runtime.conversation_builder import build_from_runs


def build_thread_messages(
    db: Session,
    *,
    thread_id: UUID,
    language: str,
    include_run_ids: list[UUID] | None = None,
    archived_until_seq_in_thread: int | None = None,
) -> list[dict[str, Any]]:
    return build_from_runs(
        db,
        thread_id=thread_id,
        language=language,
        include_run_ids=include_run_ids,
        archived_until_seq_in_thread=archived_until_seq_in_thread,
    )


def merge_run_mcp_content(
    messages: list[dict[str, Any]],
    *,
    run_id: UUID,
    resolution: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if not isinstance(resolution, dict):
        return list(messages)

    injected_messages = resolution.get("injected_messages")
    user_message_parts = resolution.get("user_message_parts")
    if not isinstance(injected_messages, list):
        injected_messages = []
    if not isinstance(user_message_parts, list):
        user_message_parts = []
    if not injected_messages and not user_message_parts:
        return list(messages)

    out: list[dict[str, Any]] = []
    merged = False
    for item in messages:
        if not merged and item.get("role") == "user" and str(item.get("run_id") or "") == str(run_id):
            out.extend(injected_messages)
            next_item = dict(item)
            content_parts = item.get("content_parts") if isinstance(item.get("content_parts"), list) else []
            next_item["content_parts"] = [*content_parts, *user_message_parts]
            out.append(next_item)
            merged = True
            continue
        out.append(item)
    return out


def merge_system_overlays(
    system_prompt: str,
    overlays: list[dict[str, Any]] | None,
) -> str:
    chunks = [str(system_prompt or "").strip()]
    for item in overlays or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if text:
            chunks.append(text)
    return "\n\n".join(chunk for chunk in chunks if chunk)


class McpMessageAssembler:
    build_thread_messages = staticmethod(build_thread_messages)
    merge_run_mcp_content = staticmethod(merge_run_mcp_content)
    merge_system_overlays = staticmethod(merge_system_overlays)

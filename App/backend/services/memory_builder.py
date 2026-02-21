from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..models.memory_models import MessageMemorySummary
from .memory_service import search_thread_memory
from .prompt_runtime.prompt_manager import PromptBundle, PromptManager
from .prompt_runtime.prompt_renderer import PromptRenderer
from .settings_service import settings_service


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
    for text in [last_user_text, last_assistant_text]:
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
) -> dict[str, Any] | None:
    queries = _build_queries(last_user_text=last_user_text, last_assistant_text=last_assistant_text)
    if not queries:
        return None

    summaries = _build_memory_summary_list(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
    )

    history_rows: list[dict[str, Any]] = []
    try:
        memory_cfg = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
        memory_items = await search_thread_memory(
            db,
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            language=language,
            queries=queries,
            top_k_per_query=int(getattr(memory_cfg, "agent_memory_top_k_per_query", 20)),
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
    except Exception:
        history_rows = []

    memory = {
        "summaries": summaries,
        "historyChats": history_rows,
    }
    if not memory["summaries"] and not memory["historyChats"]:
        return None
    return memory


async def build_memory_prompt(
    db: Session,
    *,
    prompt_manager: PromptManager,
    prompt_bundle: PromptBundle,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
    last_user_text: str,
    last_assistant_text: str,
) -> str | None:
    if not prompt_bundle.has_memory_prompt:
        return None

    memory = await build_memory_data(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
        last_user_text=last_user_text,
        last_assistant_text=last_assistant_text,
    )
    if memory is None:
        return None

    return prompt_manager.render_memory_prompt(bundle=prompt_bundle, memory=memory)


def build_memory_summary_template_data(
    *,
    project_data: dict[str, Any],
    language: str,
    previous_summary: str,
    archive_until_message_id: str,
    messages: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "config": {
            "mainLanguage": language,
            "displayLanguage": language,
            "today": datetime.now(timezone.utc).date().isoformat(),
            "thinking_mode": "off",
            "isPrefillEnabled": False,
            "outputMode": "tool_call",
        },
        "project": project_data,
        "input": {
            "userMessage": "",
            "agentMessage": "",
            "toolResults": [],
        },
        "agent": {
            "runMode": "agentMode",
            "surface": "story-object",
            "contextObjectIds": [],
        },
        "journey": {
            "kind": "",
            "payload": {},
            "targetIds": [],
        },
        "editAssistant": {
            "mode": "storyObject",
            "manuscript": {
                "currentId": "",
                "currentChapterId": "",
                "currentChapterName": "",
                "currentChapterManuscript": "",
                "objectIds": [],
            },
            "storyObject": {
                "targetIds": [],
                "contextIds": [],
                "categoryName": "",
                "editScope": "selected",
            },
        },
        "translation": {
            "sourceLanguage": "",
            "targetLanguage": "",
            "objectIds": [],
            "contextObjectIds": [],
            "currentTranslatedContents": [],
            "messages": [],
        },
        "imagePrompt": {
            "promptMode": "natural",
            "currentObject": {
                "type": "",
                "name": "",
                "description": "",
                "content": "",
                "image_prompt": "",
                "image_prompt_positive": "",
                "image_prompt_negative": "",
            },
            "scenePreContext": "",
            "scenePostContext": "",
            "selectedObjectIds": [],
        },
        "feedback": {
            "editingObjectIds": [],
        },
        "memory": {
            "summaries": [],
            "historyChats": [],
        },
        "memorySummary": {
            "previousSummary": str(previous_summary or ""),
            "messages": messages if isinstance(messages, list) else [],
            "language": str(language or "English"),
            "archiveUntilMessageId": str(archive_until_message_id or ""),
        },
        "variables": variables if isinstance(variables, dict) else {},
    }


def render_memory_summary_prompt(
    renderer: PromptRenderer,
    *,
    project_data: dict[str, Any],
    language: str,
    previous_summary: str,
    archive_until_message_id: str,
    messages: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[str, str]:
    template_data = build_memory_summary_template_data(
        project_data=project_data,
        language=language,
        previous_summary=previous_summary,
        archive_until_message_id=archive_until_message_id,
        messages=messages,
        variables=variables,
    )
    system_prompt = renderer.render_prompt(
        task_type="memory",
        task_subtype="summary",
        prompt_category="systemPrompt",
        template_data=template_data,
    )
    user_prompt = renderer.render_prompt(
        task_type="memory",
        task_subtype="summary",
        prompt_category="userPrompt",
        template_data=template_data,
    )
    return system_prompt, user_prompt

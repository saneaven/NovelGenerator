from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunToolCallModel
from ..token_count_service import count_text_tokens


def as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item is not None and str(item).strip()]


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def collapse_content_text(parts: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if str(part.get("type") or "") != "content":
            continue
        text = part.get("text")
        if isinstance(text, str):
            chunks.append(text)
    return "".join(chunks).strip()


def content_to_doc(content: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": content}],
            }
        ],
    }


async def count_tokens(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    model: str,
    text: str,
    tokenizer_override: str | None,
) -> int:
    result = await count_text_tokens(
        db,
        user_id=user_id,
        provider=provider,
        model=model,
        text=text,
        tokenizer_override=tokenizer_override,
    )
    return int(result.token_count)


def extract_last_texts(conversation: list[dict[str, Any]]) -> tuple[str, str]:
    last_user = ""
    last_assistant = ""
    for msg in conversation:
        role = msg.get("role")
        parts = msg.get("content_parts")
        if not isinstance(parts, list):
            continue
        text = "".join(str(p.get("text") or "") for p in parts if isinstance(p, dict) and p.get("type") == "content")
        if role == "user" and text.strip():
            last_user = text
        if role == "assistant" and text.strip():
            last_assistant = text
    return last_user, last_assistant


def extract_message_content_text(data: dict[str, Any], language: str) -> str:
    if not isinstance(data, dict):
        return ""
    lang_blob = data.get(language)
    if not isinstance(lang_blob, dict) or "contentParts" not in lang_blob:
        for value in data.values():
            if isinstance(value, dict) and "contentParts" in value:
                lang_blob = value
                break
    if not isinstance(lang_blob, dict):
        return ""
    parts = lang_blob.get("contentParts")
    if not isinstance(parts, list):
        return ""
    out: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if str(part.get("type") or "") != "content":
            continue
        text = part.get("text")
        if isinstance(text, str):
            out.append(text)
    return "".join(out).strip()


def tool_call_result_text(tool_call: RunToolCallModel) -> str:
    if isinstance(tool_call.result, dict):
        msg = tool_call.result.get("message")
        if isinstance(msg, str) and msg.strip():
            return msg
        return json.dumps(tool_call.result, ensure_ascii=False)
    if isinstance(tool_call.reason, str) and tool_call.reason.strip():
        return tool_call.reason
    return str(tool_call.status or "")

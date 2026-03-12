from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageAttachmentModel, RunMessageModel, RunToolCallModel
from ...providers.multimodal import attachment_to_content_part
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


def _tool_result_payload(tool_call: RunToolCallModel) -> dict[str, Any] | None:
    result_text = tool_call_result_text(tool_call).strip()
    if not result_text:
        return None
    tool_call_id = str(getattr(tool_call, "llm_call_id", "") or "").strip() or str(tool_call.id)
    return {
        "tool_call_id": tool_call_id,
        "tool_name": str(tool_call.tool_name or "").strip() or "tool_result",
        "content": result_text,
    }


def build_active_messages_for_budget(
    *,
    message: RunMessageModel,
    language: str,
    tool_calls: list[RunToolCallModel],
    attachments: list[RunMessageAttachmentModel],
) -> list[dict[str, Any]]:
    text = extract_message_content_text(message.data if isinstance(message.data, dict) else {}, language)
    content_parts: list[dict[str, Any]] = []
    if text:
        content_parts.append({"type": "content", "text": text})
    content_parts.extend(
        attachment_to_content_part(attachment)
        for attachment in attachments
        if isinstance(attachment, RunMessageAttachmentModel)
    )

    msg: dict[str, Any] = {
        "role": str(message.role or ""),
        "content_parts": content_parts,
    }
    if tool_calls:
        msg["tool_calls"] = [
            {
                "id": str(getattr(tool_call, "llm_call_id", "") or tool_call.id),
                "type": "function",
                "function": {
                    "name": str(tool_call.tool_name or ""),
                    "arguments": json.dumps(
                        tool_call.arguments if isinstance(tool_call.arguments, dict) else {},
                        ensure_ascii=False,
                    ),
                },
            }
            for tool_call in tool_calls
        ]

    out = [msg]
    tool_results = [
        payload
        for tool_call in tool_calls
        if (payload := _tool_result_payload(tool_call)) is not None
    ]
    if tool_results:
        out.append({"role": "tool_results", "content_parts": [], "tool_results": tool_results})
    return out


def build_archive_payload_for_message(
    *,
    message: RunMessageModel,
    language: str,
    tool_calls: list[RunToolCallModel],
) -> dict[str, Any]:
    content = extract_message_content_text(message.data if isinstance(message.data, dict) else {}, language)
    tc_payload: list[dict[str, Any]] = []
    for tool_call in tool_calls:
        tc_payload.append(
            {
                "id": str(tool_call.llm_call_id or tool_call.id),
                "name": str(tool_call.tool_name or ""),
                "status": str(tool_call.status or ""),
                "arguments": tool_call.arguments if isinstance(tool_call.arguments, dict) else {},
                "result": tool_call.result if tool_call.result is not None else "",
                "reason": str(tool_call.reason or ""),
            }
        )
    return {
        "message_id": message.id,
        "role": message.role,
        "content": content,
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "tool_calls": tc_payload,
    }


def format_summary_message_content(
    *,
    content: str,
    tool_calls: list[RunToolCallModel],
) -> str:
    chunks: list[str] = []
    if content:
        chunks.append(content)
    for tool_call in tool_calls:
        result = tool_call_result_text(tool_call)
        chunks.append(
            (
                f'<function_call name="{tool_call.tool_name}" status="{tool_call.status}">\n'
                f"<result>{result}</result>\n"
                "</function_call>"
            )
        )
    return "\n\n".join(chunks).strip()

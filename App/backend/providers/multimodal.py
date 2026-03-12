from __future__ import annotations

from typing import Any

from ..models.db_models import RunMessageAttachmentModel
from ..services.chat_attachment_service import chat_attachment_service


def get_canonical_content_parts(message: dict[str, Any]) -> list[dict[str, Any]]:
    parts = message.get("content_parts")
    if not isinstance(parts, list):
        return []
    return [part for part in parts if isinstance(part, dict)]


def extract_text_content(parts: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for part in parts:
        if part.get("type") != "content":
            continue
        text = part.get("text")
        if isinstance(text, str) and text:
            chunks.append(text)
    return "".join(chunks)


def attachment_to_content_part(attachment: RunMessageAttachmentModel) -> dict[str, Any]:
    base: dict[str, Any] = {
        "mime_type": str(attachment.mime_type or "").strip(),
        "filename": str(attachment.original_filename or "").strip(),
        "storage_key": str(attachment.storage_key or "").strip(),
    }
    if attachment.kind == "image":
        base["width"] = int(attachment.width) if attachment.width is not None else None
        base["height"] = int(attachment.height) if attachment.height is not None else None
        return {"type": "image", **base}
    return {"type": "file", **base}


def _load_binary_part(part: dict[str, Any]) -> tuple[str, str, bytes]:
    mime_type = str(part.get("mime_type") or "").strip()
    filename = str(part.get("filename") or "").strip() or "attachment"
    storage_key = str(part.get("storage_key") or "").strip()
    if not mime_type or not storage_key:
        raise ValueError("Attachment content part is missing mime_type or storage_key")
    data = chat_attachment_service.load_attachment_bytes(storage_key)
    return mime_type, filename, data


def build_openai_chat_content(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for part in parts:
        part_type = part.get("type")
        if part_type == "content":
            text = part.get("text")
            if isinstance(text, str) and text:
                out.append({"type": "text", "text": text})
            continue
        if part_type == "image":
            mime_type, _filename, data = _load_binary_part(part)
            out.append(
                {
                    "type": "image_url",
                    "image_url": {"url": chat_attachment_service.to_data_url(mime_type, data)},
                }
            )
            continue
        if part_type == "file":
            mime_type, filename, data = _load_binary_part(part)
            out.append(
                {
                    "type": "file",
                    "file": {
                        "filename": filename,
                        "file_data": chat_attachment_service.to_data_url(mime_type, data),
                    },
                }
            )
    return out


def build_openai_responses_content(parts: list[dict[str, Any]], *, role: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for part in parts:
        part_type = part.get("type")
        if part_type == "content":
            text = part.get("text")
            if isinstance(text, str) and text:
                out.append({"type": "output_text" if role == "assistant" else "input_text", "text": text})
            continue
        if role == "assistant":
            continue
        if part_type == "image":
            mime_type, _filename, data = _load_binary_part(part)
            out.append({"type": "input_image", "image_url": chat_attachment_service.to_data_url(mime_type, data)})
            continue
        if part_type == "file":
            mime_type, filename, data = _load_binary_part(part)
            out.append(
                {
                    "type": "input_file",
                    "filename": filename,
                    "file_data": chat_attachment_service.to_data_url(mime_type, data),
                }
            )
    return out


def build_claude_content(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for part in parts:
        part_type = part.get("type")
        if part_type == "content":
            text = part.get("text")
            if isinstance(text, str) and text:
                out.append({"type": "text", "text": text})
            continue
        if part_type == "image":
            mime_type, _filename, data = _load_binary_part(part)
            out.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": chat_attachment_service.to_data_url(mime_type, data).split(",", 1)[1],
                    },
                }
            )
            continue
        if part_type == "file":
            mime_type, _filename, data = _load_binary_part(part)
            out.append(
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": chat_attachment_service.to_data_url(mime_type, data).split(",", 1)[1],
                    },
                }
            )
    return out


def build_gemini_binary_parts(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for part in parts:
        part_type = part.get("type")
        if part_type == "content":
            text = part.get("text")
            if isinstance(text, str) and text:
                out.append({"type": "text", "text": text})
            continue
        if part_type in {"image", "file"}:
            mime_type, filename, data = _load_binary_part(part)
            out.append({"type": "binary", "mime_type": mime_type, "filename": filename, "data": data})
    return out

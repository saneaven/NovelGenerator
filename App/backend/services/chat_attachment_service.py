from __future__ import annotations

import base64
import io
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from uuid import UUID

from PIL import Image
from sqlalchemy.orm import Session

from ..models.db_models import RunMessageAttachmentModel
from .storage_service import storage_service


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return int(raw) if raw is not None else default
    except ValueError:
        return default


CHAT_ATTACHMENT_MAX_FILES = max(1, _int_env("CHAT_ATTACHMENT_MAX_FILES", 5))
CHAT_ATTACHMENT_MAX_FILE_BYTES = max(1, _int_env("CHAT_ATTACHMENT_MAX_FILE_BYTES", 10 * 1024 * 1024))
CHAT_ATTACHMENT_MAX_TOTAL_BYTES = max(CHAT_ATTACHMENT_MAX_FILE_BYTES, _int_env("CHAT_ATTACHMENT_MAX_TOTAL_BYTES", 20 * 1024 * 1024))
CHAT_ATTACHMENT_STORAGE_PREFIX = "chat-attachments"
ALLOWED_TEXT_MIME_TYPES = {
    "text/plain",
    "text/csv",
    "text/xml",
    "text/html",
    "text/markdown",
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
}
ALLOWED_ATTACHMENT_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
}.union(ALLOWED_TEXT_MIME_TYPES)
TEXT_FILE_EXTENSION_TO_MIME = {
    ".txt": "text/plain",
    ".json": "application/json",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".md": "text/markdown",
    ".html": "text/html",
    ".toml": "application/toml",
}


class ChatAttachmentValidationError(ValueError):
    def __init__(self, message: str, *, status_code: int = 422):
        super().__init__(message)
        self.status_code = int(status_code)


@dataclass(frozen=True)
class IncomingMessageAttachment:
    filename: str
    mime_type: str
    content: bytes


@dataclass(frozen=True)
class InspectedAttachment:
    kind: str
    mime_type: str
    filename: str
    content: bytes
    file_size: int
    width: int | None = None
    height: int | None = None


class ChatAttachmentService:
    def build_public_path(self, storage_key: str) -> str:
        normalized = str(storage_key or "").strip().replace("\\", "/").lstrip("/")
        return f"/storage/chat-attachments/{normalized}"

    def inspect_attachment(self, attachment: IncomingMessageAttachment) -> InspectedAttachment:
        filename = str(attachment.filename or "").strip() or "attachment"
        mime_type = str(attachment.mime_type or "").strip().lower()
        if mime_type in {"", "application/octet-stream"}:
            mime_type = TEXT_FILE_EXTENSION_TO_MIME.get(Path(filename).suffix.lower(), mime_type)
        if mime_type not in ALLOWED_ATTACHMENT_MIME_TYPES:
            raise ChatAttachmentValidationError(f"Unsupported attachment type: {mime_type or 'unknown'}")

        content = attachment.content or b""
        file_size = len(content)
        if file_size <= 0:
            raise ChatAttachmentValidationError("Attachment is empty")
        if file_size > CHAT_ATTACHMENT_MAX_FILE_BYTES:
            raise ChatAttachmentValidationError("Attachment exceeds the maximum file size", status_code=413)

        if mime_type in ALLOWED_TEXT_MIME_TYPES:
            if b"\x00" in content:
                raise ChatAttachmentValidationError("File appears to be binary, not UTF-8 text")
            try:
                content.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ChatAttachmentValidationError("File is not valid UTF-8 text") from exc
            return InspectedAttachment(
                kind="text_file",
                mime_type=mime_type,
                filename=filename,
                content=content,
                file_size=file_size,
            )

        if mime_type == "application/pdf":
            if not content.startswith(b"%PDF-"):
                raise ChatAttachmentValidationError("Invalid PDF file")
            return InspectedAttachment(
                kind="document",
                mime_type=mime_type,
                filename=filename if filename.lower().endswith(".pdf") else f"{filename}.pdf",
                content=content,
                file_size=file_size,
            )

        try:
            with Image.open(io.BytesIO(content)) as image:
                image.load()
                width, height = image.size
        except Exception as exc:  # noqa: BLE001
            raise ChatAttachmentValidationError("Invalid image file") from exc

        return InspectedAttachment(
            kind="image",
            mime_type=mime_type,
            filename=filename,
            content=content,
            file_size=file_size,
            width=int(width),
            height=int(height),
        )

    def ingest_message_attachments(
        self,
        db: Session,
        *,
        project_id: UUID,
        thread_id: UUID,
        run_id: UUID,
        message_id: UUID,
        attachments: list[IncomingMessageAttachment],
    ) -> list[RunMessageAttachmentModel]:
        if not attachments:
            return []
        if len(attachments) > CHAT_ATTACHMENT_MAX_FILES:
            raise ChatAttachmentValidationError("Too many attachments", status_code=413)

        inspected = [self.inspect_attachment(item) for item in attachments]
        total_bytes = sum(item.file_size for item in inspected)
        if total_bytes > CHAT_ATTACHMENT_MAX_TOTAL_BYTES:
            raise ChatAttachmentValidationError("Attachments exceed the total upload size limit", status_code=413)

        created_rows: list[RunMessageAttachmentModel] = []
        written_keys: list[str] = []
        try:
            for sort_order, item in enumerate(inspected):
                suffix = Path(item.filename).suffix.lower()
                safe_name = item.filename if suffix else f"{item.filename}{'.pdf' if item.kind == 'document' else ''}"
                storage_key, stored_mime_type, stored_size = storage_service.save_raw_file(
                    item.content,
                    safe_name,
                    project_id,
                    storage_prefix=CHAT_ATTACHMENT_STORAGE_PREFIX,
                    mime_type=item.mime_type,
                )
                written_keys.append(storage_key)
                row = RunMessageAttachmentModel(
                    project_id=project_id,
                    thread_id=thread_id,
                    run_id=run_id,
                    message_id=message_id,
                    sort_order=sort_order,
                    kind=item.kind,
                    mime_type=stored_mime_type,
                    original_filename=item.filename,
                    file_size=stored_size,
                    storage_key=storage_key,
                    width=item.width,
                    height=item.height,
                )
                db.add(row)
                created_rows.append(row)
            db.flush()
            return created_rows
        except Exception:
            for storage_key in written_keys:
                try:
                    storage_service.delete_asset_files(storage_key)
                except Exception:
                    pass
            raise

    def load_attachment_bytes(self, storage_key: str) -> bytes:
        return storage_service.read_asset_file(storage_key)

    def to_data_url(self, mime_type: str, content: bytes) -> str:
        encoded = base64.b64encode(content).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    def delete_attachment_files(self, attachments: Iterable[RunMessageAttachmentModel]) -> None:
        for attachment in attachments:
            storage_key = str(getattr(attachment, "storage_key", "") or "").strip()
            if not storage_key:
                continue
            try:
                storage_service.delete_asset_files(storage_key)
            except Exception:
                pass

    def serialize_attachment(self, row: RunMessageAttachmentModel) -> dict[str, object]:
        return {
            "id": str(row.id),
            "message_id": str(row.message_id),
            "sort_order": int(row.sort_order),
            "kind": row.kind,
            "mime_type": row.mime_type,
            "original_filename": row.original_filename,
            "file_size": int(row.file_size or 0),
            "url": self.build_public_path(str(row.storage_key)),
            "width": int(row.width) if row.width is not None else None,
            "height": int(row.height) if row.height is not None else None,
            "created_at": row.created_at.isoformat() if row.created_at is not None else None,
        }


chat_attachment_service = ChatAttachmentService()

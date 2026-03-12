from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..models.db_models import Project, RunMessageAttachmentModel
from .storage_service import (
    AssetFileNotFoundError,
    AssetStorageUnavailableError,
    StorageService,
    storage_service,
)


def build_chat_attachment_proxy_response(
    attachment_key: str,
    *,
    user_id: UUID,
    db: Session,
    storage: StorageService = storage_service,
) -> StreamingResponse:
    normalized_key = str(attachment_key or "").lstrip("/")
    if not normalized_key:
        raise HTTPException(status_code=404, detail="Attachment not found")

    attachment = (
        db.query(RunMessageAttachmentModel)
        .join(Project, Project.id == RunMessageAttachmentModel.project_id)
        .filter(
            RunMessageAttachmentModel.storage_key == normalized_key,
            Project.user_id == user_id,
        )
        .first()
    )
    if attachment is None:
        raise HTTPException(status_code=404, detail="Attachment not found")

    try:
        asset_stream = storage.open_asset_stream(str(attachment.storage_key))
    except AssetFileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Attachment not found") from exc
    except AssetStorageUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Attachment storage unavailable") from exc

    headers = {
        "cache-control": "private, no-store",
        "vary": "Authorization",
    }
    if asset_stream.content_length is not None:
        headers["content-length"] = str(asset_stream.content_length)
    if asset_stream.etag:
        headers["etag"] = asset_stream.etag
    if asset_stream.last_modified:
        headers["last-modified"] = asset_stream.last_modified

    return StreamingResponse(
        storage.iter_asset_stream(asset_stream),
        media_type=asset_stream.content_type,
        headers=headers,
    )

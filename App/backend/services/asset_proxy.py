from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from uuid import UUID

from ..models.db_models import Asset, Project
from .storage_service import (
    AssetFileNotFoundError,
    AssetStorageUnavailableError,
    StorageService,
    storage_service,
)


def build_asset_proxy_response(
    asset_key: str,
    *,
    user_id: UUID,
    db: Session,
    storage: StorageService = storage_service,
) -> StreamingResponse:
    normalized_key = str(asset_key or "").lstrip("/")
    if not normalized_key:
        raise HTTPException(status_code=404, detail="Asset not found")

    asset = (
        db.query(Asset)
        .join(Project, Project.id == Asset.project_id)
        .filter(
            Asset.file_path == normalized_key,
            Project.user_id == user_id,
        )
        .first()
    )
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    try:
        asset_stream = storage.open_asset_stream(str(asset.file_path))
    except AssetFileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Asset not found") from exc
    except AssetStorageUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Asset storage unavailable") from exc

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

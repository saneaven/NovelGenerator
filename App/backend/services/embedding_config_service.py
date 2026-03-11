from __future__ import annotations

from typing import Any, Dict, Literal, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import UserSettings
from .search_memory_settings import (
    has_search_memory_override,
    validate_search_memory_settings,
)
from .settings_service import settings_service


EmbeddingFeature = Literal["search", "memory"]


def get_embedding_profile(
    db: Session,
    *,
    user_id: UUID,
    feature: EmbeddingFeature,
) -> Optional[Dict[str, Any]]:
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if settings is None or not settings_service.is_vector_storage_enabled(db, user_id):
        return None
    resolved = (
        settings_service.get_search_settings(db, user_id)
        if feature == "search"
        else settings_service.get_memory_settings(db, user_id)
    )
    provider = (resolved.embedding.provider or "").strip()
    model = (resolved.embedding.model or "").strip()
    dimensions = int(resolved.embedding.dimensions) if isinstance(resolved.embedding.dimensions, int) else None

    if not provider or not model:
        return None

    return {"provider": provider, "model": model, "dimensions": dimensions}


def set_embedding_dimensions(
    db: Session,
    *,
    user_id: UUID,
    feature: EmbeddingFeature,
    dimensions: int,
) -> None:
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if not settings:
        return

    raw = validate_search_memory_settings(getattr(settings, "search_memory_settings", None))
    if feature == "search" and has_search_memory_override(raw, "search"):
        raw["overrides"]["search"]["embedding"]["dimensions"] = int(dimensions)
    elif feature == "memory" and has_search_memory_override(raw, "memory"):
        raw["overrides"]["memory"]["embedding"]["dimensions"] = int(dimensions)
    else:
        raw["general"]["embedding"]["dimensions"] = int(dimensions)
    settings.search_memory_settings = raw  # type: ignore


__all__ = [
    "EmbeddingFeature",
    "get_embedding_profile",
    "set_embedding_dimensions",
]

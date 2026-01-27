from __future__ import annotations

from typing import Any, Dict, Literal, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import UserSettings


EmbeddingFeature = Literal["ragSearch", "agentMemory"]


DEFAULT_EMBEDDING_CONFIGS: Dict[str, Dict[str, Any]] = {
    "ragSearch": {"provider": "openai", "model": "", "dimensions": None},
    "agentMemory": {"provider": "openai", "model": "", "dimensions": None},
}


def merge_embedding_configs(raw: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(raw, dict):
        raw = {}
    merged: Dict[str, Dict[str, Any]] = {}
    for key, default_cfg in DEFAULT_EMBEDDING_CONFIGS.items():
        candidate = raw.get(key)
        if not isinstance(candidate, dict):
            candidate = {}
        merged[key] = {**default_cfg, **candidate}
    return merged


def get_embedding_profile(
    db: Session,
    *,
    user_id: UUID,
    feature: EmbeddingFeature,
) -> Optional[Dict[str, Any]]:
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    # Global embeddings toggle (historically `rag_search_enabled`).
    if settings and not bool(getattr(settings, "rag_search_enabled", False)):
        return None
    cfg = merge_embedding_configs(getattr(settings, "embedding_configs", None) if settings else None)

    profile = cfg.get(feature) or {}
    provider = (profile.get("provider") or "").strip()
    model = (profile.get("model") or "").strip()
    dims = profile.get("dimensions")
    dimensions = int(dims) if isinstance(dims, int) else None

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

    cfg = merge_embedding_configs(getattr(settings, "embedding_configs", None))
    cfg.setdefault(feature, {})
    cfg[feature]["dimensions"] = int(dimensions)
    settings.embedding_configs = cfg  # type: ignore


__all__ = [
    "EmbeddingFeature",
    "DEFAULT_EMBEDDING_CONFIGS",
    "get_embedding_profile",
    "merge_embedding_configs",
    "set_embedding_dimensions",
]

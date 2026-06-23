from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import UserSettings
from .search_memory_settings import (
    make_initial_search_memory_settings,
    resolve_memory_settings,
    resolve_search_settings,
    validate_search_memory_settings,
)
from .task_config_settings import (
    make_initial_task_config_settings,
    resolve_task_config,
    validate_task_config_settings,
)

DEFAULT_RETRY_CONFIG: dict[str, Any] = {
    "enabled": True,
    "maxRetries": 3,
    "retryableStatusCodes": [429, 500, 502, 503, 504],
    "retryDelayMs": 1000,
}


@dataclass
class TaskConfig:
    provider: str
    model: str
    temperature: float
    provider_preference: dict[str, Any] | None
    max_output_tokens: int | None
    context_window_tokens: int | None
    supports_image_input: bool
    advanced: dict[str, Any]


@dataclass
class EmbeddingConfig:
    provider: str
    model: str
    dimensions: int | None


@dataclass
class RetrievalSettings:
    top_k_per_query: int
    neighbor_window: int
    max_primary_items: int
    max_total_items: int


@dataclass
class SearchSettings:
    enabled: bool
    embedding: EmbeddingConfig
    retrieval: RetrievalSettings
    regex_page_size: int


@dataclass
class MemorySettings:
    enabled: bool
    embedding: EmbeddingConfig
    retrieval: RetrievalSettings


class SettingsService:
    def create_settings_row(self, *, user_id: UUID, demo_mode_enabled: bool = False) -> UserSettings:
        return UserSettings(
            user_id=user_id,
            task_config_settings=make_initial_task_config_settings(),
            search_memory_settings=make_initial_search_memory_settings(),
            main_language="English",
            sub_languages=[],
            default_sub_language=None,
            demo_mode_enabled=demo_mode_enabled,
        )

    def _get_settings(self, db: Session, user_id: UUID) -> UserSettings:
        settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
        if settings is None:
            settings = self.create_settings_row(user_id=user_id)
            db.add(settings)
            db.flush()
        return settings

    def get_or_create_settings(self, db: Session, user_id: UUID) -> UserSettings:
        return self._get_settings(db, user_id)

    def get_task_config_settings(self, db: Session, user_id: UUID) -> dict[str, Any]:
        settings = self._get_settings(db, user_id)
        raw = getattr(settings, "task_config_settings", None)
        if not isinstance(raw, dict):
            raise ValueError("Stored task_config_settings must be an object")
        return validate_task_config_settings(raw)

    def get_task_config(self, db: Session, user_id: UUID, task_type: str) -> TaskConfig:
        settings = self._get_settings(db, user_id)
        if bool(getattr(settings, "demo_mode_enabled", False)):
            from .demo_runtime import build_demo_task_config

            return build_demo_task_config()

        cfg = resolve_task_config(self.get_task_config_settings(db, user_id), task_type)
        provider_preference = cfg.get("provider_preference")

        return TaskConfig(
            provider=str(cfg["provider"]),
            model=str(cfg["model"]),
            temperature=float(cfg["temperature"]),
            provider_preference=provider_preference if isinstance(provider_preference, dict) else None,
            max_output_tokens=cfg.get("max_output_tokens"),
            context_window_tokens=cfg.get("context_window_tokens"),
            supports_image_input=bool(cfg.get("supports_image_input", True)),
            advanced=cfg.get("advanced") if isinstance(cfg.get("advanced"), dict) else {},
        )

    def get_active_preset_id(self, db: Session, user_id: UUID) -> UUID | None:
        settings = self._get_settings(db, user_id)
        return settings.active_preset_id

    def get_search_memory_settings(self, db: Session, user_id: UUID) -> dict[str, Any]:
        settings = self._get_settings(db, user_id)
        raw = getattr(settings, "search_memory_settings", None)
        if not isinstance(raw, dict):
            raise ValueError("Stored search_memory_settings must be an object")
        return validate_search_memory_settings(raw)

    def is_vector_storage_enabled(self, db: Session, user_id: UUID) -> bool:
        settings = self.get_search_memory_settings(db, user_id)
        return bool(settings.get("enabled"))

    def get_search_settings(self, db: Session, user_id: UUID) -> SearchSettings:
        settings = self.get_search_memory_settings(db, user_id)
        resolved = resolve_search_settings(settings)
        embedding = resolved.get("embedding", {})
        retrieval = resolved.get("retrieval", {})
        return SearchSettings(
            enabled=bool(settings.get("enabled")),
            embedding=EmbeddingConfig(
                provider=str(embedding.get("provider") or "openai"),
                model=str(embedding.get("model") or ""),
                dimensions=embedding.get("dimensions"),
            ),
            retrieval=RetrievalSettings(
                top_k_per_query=int(retrieval.get("topKPerQuery") or 20),
                neighbor_window=int(retrieval.get("neighborWindow") or 0),
                max_primary_items=int(retrieval.get("maxPrimaryItems") or 20),
                max_total_items=int(retrieval.get("maxTotalItems") or 60),
            ),
            regex_page_size=int(resolved.get("regexPageSize") or 20),
        )

    def get_memory_settings(self, db: Session, user_id: UUID) -> MemorySettings:
        settings = self.get_search_memory_settings(db, user_id)
        resolved = resolve_memory_settings(settings)
        embedding = resolved.get("embedding", {})
        retrieval = resolved.get("retrieval", {})
        return MemorySettings(
            enabled=bool(settings.get("enabled")),
            embedding=EmbeddingConfig(
                provider=str(embedding.get("provider") or "openai"),
                model=str(embedding.get("model") or ""),
                dimensions=embedding.get("dimensions"),
            ),
            retrieval=RetrievalSettings(
                top_k_per_query=int(retrieval.get("topKPerQuery") or 20),
                neighbor_window=int(retrieval.get("neighborWindow") or 0),
                max_primary_items=int(retrieval.get("maxPrimaryItems") or 20),
                max_total_items=int(retrieval.get("maxTotalItems") or 60),
            ),
        )

    def get_search_embedding_config(self, db: Session, user_id: UUID) -> EmbeddingConfig:
        settings = self.get_search_settings(db, user_id)
        return EmbeddingConfig(
            provider=settings.embedding.provider,
            model=settings.embedding.model,
            dimensions=settings.embedding.dimensions,
        )

    def get_memory_embedding_config(self, db: Session, user_id: UUID) -> EmbeddingConfig:
        settings = self.get_memory_settings(db, user_id)
        return EmbeddingConfig(
            provider=settings.embedding.provider,
            model=settings.embedding.model,
            dimensions=settings.embedding.dimensions,
        )

    def get_retry_config(self, db: Session, user_id: UUID) -> dict[str, Any]:
        settings = self._get_settings(db, user_id)
        retry = settings.retry_config if isinstance(settings.retry_config, dict) else {}

        merged = dict(DEFAULT_RETRY_CONFIG)
        merged.update(retry)
        if not isinstance(merged.get("retryableStatusCodes"), list):
            merged["retryableStatusCodes"] = list(DEFAULT_RETRY_CONFIG["retryableStatusCodes"])
        return merged


settings_service = SettingsService()

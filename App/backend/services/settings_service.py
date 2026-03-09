from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import UserSettings
from .task_config_settings import (
    make_initial_task_config_settings,
    resolve_task_config,
    validate_task_config_settings,
)

DEFAULT_AUTO_APPROVE: dict[str, bool] = {
    "create": False,
    "delete": False,
    "patch": False,
    "replace": False,
    "read": False,
    "search": False,
    "subAgent": False,
}

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
    advanced: dict[str, Any]


@dataclass
class EmbeddingConfig:
    provider: str
    model: str
    dimensions: int | None


@dataclass
class RagSettings:
    enabled: bool
    top_k_per_query: int
    neighbor_window: int
    max_primary_chunks: int
    max_total_chunks: int
    keyword_page_size: int


class SettingsService:
    def create_settings_row(self, *, user_id: UUID) -> UserSettings:
        return UserSettings(
            user_id=user_id,
            task_config_settings=make_initial_task_config_settings(),
            main_language="English",
            sub_languages=[],
            default_sub_language=None,
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
        cfg = resolve_task_config(self.get_task_config_settings(db, user_id), task_type)
        provider_preference = cfg.get("provider_preference")

        return TaskConfig(
            provider=str(cfg["provider"]),
            model=str(cfg["model"]),
            temperature=float(cfg["temperature"]),
            provider_preference=provider_preference if isinstance(provider_preference, dict) else None,
            max_output_tokens=cfg.get("max_output_tokens"),
            context_window_tokens=cfg.get("context_window_tokens"),
            advanced=cfg.get("advanced") if isinstance(cfg.get("advanced"), dict) else {},
        )

    def get_active_preset_id(self, db: Session, user_id: UUID) -> UUID | None:
        settings = self._get_settings(db, user_id)
        return settings.active_preset_id

    def get_embedding_config(self, db: Session, user_id: UUID, feature: str) -> EmbeddingConfig:
        settings = self._get_settings(db, user_id)
        all_cfg = settings.embedding_configs if isinstance(settings.embedding_configs, dict) else {}
        cfg = all_cfg.get(feature) if isinstance(all_cfg, dict) else None
        if not isinstance(cfg, dict):
            cfg = {"provider": "openai", "model": "", "dimensions": None}
        return EmbeddingConfig(
            provider=str(cfg.get("provider") or "openai"),
            model=str(cfg.get("model") or ""),
            dimensions=cfg.get("dimensions"),
        )

    def get_rag_settings(self, db: Session, user_id: UUID) -> RagSettings:
        settings = self._get_settings(db, user_id)
        return RagSettings(
            enabled=bool(getattr(settings, "rag_search_enabled", False)),
            top_k_per_query=int(getattr(settings, "rag_search_top_k_per_query", 20)),
            neighbor_window=int(getattr(settings, "rag_search_neighbor_window", 0)),
            max_primary_chunks=int(getattr(settings, "rag_search_max_primary_chunks", 20)),
            max_total_chunks=int(getattr(settings, "rag_search_max_total_chunks", 60)),
            keyword_page_size=int(getattr(settings, "rag_search_keyword_page_size", 20)),
        )

    def get_tool_auto_approve_policy(self, db: Session, user_id: UUID) -> dict[str, bool]:
        settings = self._get_settings(db, user_id)
        policy = settings.tool_call_auto_approve if isinstance(settings.tool_call_auto_approve, dict) else {}
        merged: dict[str, bool] = {**DEFAULT_AUTO_APPROVE}
        for key, value in policy.items() if isinstance(policy, dict) else []:
            if key in merged:
                merged[key] = bool(value)
        return merged

    def get_retry_config(self, db: Session, user_id: UUID) -> dict[str, Any]:
        settings = self._get_settings(db, user_id)
        retry = settings.retry_config if isinstance(settings.retry_config, dict) else {}

        merged = dict(DEFAULT_RETRY_CONFIG)
        merged.update(retry)
        if not isinstance(merged.get("retryableStatusCodes"), list):
            merged["retryableStatusCodes"] = list(DEFAULT_RETRY_CONFIG["retryableStatusCodes"])
        return merged


settings_service = SettingsService()

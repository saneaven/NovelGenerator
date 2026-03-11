from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from .credential_service import credential_service
from .demo_runtime import build_demo_provider_config, build_demo_task_config
from .settings_service import TaskConfig, settings_service


@dataclass(frozen=True)
class LLMRuntime:
    provider: str
    task_config: TaskConfig
    provider_config: dict[str, Any]


def get_llm_runtime(db: Session, *, user_id: UUID, task_type: str) -> LLMRuntime:
    settings = settings_service.get_or_create_settings(db, user_id)
    if bool(getattr(settings, "demo_mode_enabled", False)):
        return LLMRuntime(
            provider="openrouter",
            task_config=build_demo_task_config(),
            provider_config=build_demo_provider_config(),
        )

    task_config = settings_service.get_task_config(db, user_id, task_type)
    provider_config = credential_service.get_provider_config(db, user_id, task_config.provider)
    if task_config.provider == "custom":
        custom_kind = task_config.advanced.get("custom_kind") if isinstance(task_config.advanced, dict) else None
        provider_config = {
            **provider_config,
            "custom_kind": custom_kind or "openai_completion",
        }

    return LLMRuntime(
        provider=task_config.provider,
        task_config=task_config,
        provider_config=provider_config,
    )

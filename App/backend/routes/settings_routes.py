"""API routes for user settings."""
from __future__ import annotations

from copy import deepcopy
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User, UserSettings
from ..schemas.settings import UserSettingsResponse, UserSettingsUpdate
from ..services.embedding_config_service import merge_embedding_configs
from ..services.image_model_catalog_service import default_image_gen_config
from ..services.memory_service import wipe_memory_index
from ..services.rag_index_service import wipe_user_index
from ..services.settings_service import settings_service
from ..services.task_config_settings import validate_task_config_settings

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])

def _assign_template_ids(templates: list) -> list:
    """Ensure every thinking template dict has an id assigned."""
    for template in templates:
        if isinstance(template, dict) and not template.get("id"):
            template["id"] = str(uuid.uuid4())
    return templates


def _cascade_clear_deleted_templates(settings: UserSettings, new_template_ids: set[str]) -> None:
    """Clear stale custom thinking template ids from general and overrides."""
    raw = getattr(settings, "task_config_settings", None)
    if not isinstance(raw, dict):
        return

    changed = False

    def _clear_in_payload(payload: object) -> None:
        nonlocal changed
        if not isinstance(payload, dict):
            return
        advanced = payload.get("advanced")
        if not isinstance(advanced, dict):
            return
        template_id = advanced.get("custom_thinking_template_id")
        if isinstance(template_id, str) and template_id and template_id not in new_template_ids:
            advanced.pop("custom_thinking_template_id", None)
            changed = True

    _clear_in_payload(raw.get("general"))

    overrides = raw.get("overrides")
    if isinstance(overrides, dict):
        for override in overrides.values():
            _clear_in_payload(override)

    if changed:
        settings.task_config_settings = validate_task_config_settings(raw)  # type: ignore[assignment]


def _build_settings_response(settings: UserSettings) -> UserSettingsResponse:
    raw_task_config_settings = getattr(settings, "task_config_settings", None)
    if not isinstance(raw_task_config_settings, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stored task config settings are invalid.",
        )

    try:
        task_config_settings = validate_task_config_settings(raw_task_config_settings)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stored task config settings are invalid: {exc}",
        ) from exc

    retry_config_dict = getattr(settings, "retry_config", None) or {
        "enabled": True,
        "maxRetries": 3,
        "retryableStatusCodes": [429, 500, 502, 503, 504],
        "retryDelayMs": 1000,
    }
    image_gen_config_dict = getattr(settings, "image_gen_config", None) or deepcopy(default_image_gen_config())
    tool_call_auto_approve_dict = getattr(settings, "tool_call_auto_approve", None) or {
        "create": False,
        "delete": False,
        "patch": False,
        "replace": False,
        "read": False,
        "search": False,
        "subAgent": False,
    }
    embedding_configs_dict = merge_embedding_configs(getattr(settings, "embedding_configs", None))

    return UserSettingsResponse(
        taskConfigSettings=task_config_settings,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme,
        retryConfig=retry_config_dict,  # type: ignore[arg-type]
        imageGenConfig=image_gen_config_dict,  # type: ignore[arg-type]
        customThinkingTemplates=getattr(settings, "custom_thinking_templates", []) or [],
        nativeOutputMode=settings.native_output_mode,
        vectorStorageEnabled=getattr(settings, "vector_storage_enabled", False),
        embeddingConfigs=embedding_configs_dict,
        ragSearchTopKPerQuery=getattr(settings, "rag_search_top_k_per_query", 20),
        ragSearchNeighborWindow=getattr(settings, "rag_search_neighbor_window", 0),
        ragSearchMaxPrimaryChunks=getattr(settings, "rag_search_max_primary_chunks", 20),
        ragSearchMaxTotalChunks=getattr(settings, "rag_search_max_total_chunks", 60),
        ragSearchKeywordPageSize=getattr(settings, "rag_search_keyword_page_size", 20),
        agentMemoryTopKPerQuery=getattr(settings, "agent_memory_top_k_per_query", 20),
        agentMemoryNeighborWindow=getattr(settings, "agent_memory_neighbor_window", 0),
        agentMemoryMaxPrimaryMessages=getattr(settings, "agent_memory_max_primary_messages", 20),
        agentMemoryMaxTotalMessages=getattr(settings, "agent_memory_max_total_messages", 60),
        patchAutoRetry=getattr(settings, "patch_auto_retry", True),
        llmLoggingEnabled=getattr(settings, "llm_logging_enabled", False),
        toolCallHistoryLimit=getattr(settings, "tool_call_history_limit", 5),
        thinkingHistoryLimit=getattr(settings, "thinking_history_limit", 5),
        toolCallAutoApprove=tool_call_auto_approve_dict,
        uiLanguage=getattr(settings, "ui_language", "en"),
        demoModeEnabled=bool(getattr(settings, "demo_mode_enabled", False)),
    )


@router.get("", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get current user's settings."""
    settings = settings_service.get_or_create_settings(db, current_user.id)
    db.commit()
    db.refresh(settings)
    return _build_settings_response(settings)


@router.put("", response_model=UserSettingsResponse)
async def update_user_settings(
    update_data: UserSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update user settings."""
    settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Settings not found. Please get settings first.",
        )

    if "demoModeEnabled" in update_data.model_fields_set and update_data.demoModeEnabled is not None:
        settings.demo_mode_enabled = update_data.demoModeEnabled  # type: ignore[assignment]

    demo_mode_enabled = bool(getattr(settings, "demo_mode_enabled", False))

    if not demo_mode_enabled and update_data.taskConfigSettings is not None:
        raw_task_config_settings = update_data.taskConfigSettings.model_dump(exclude_unset=True)
        try:
            settings.task_config_settings = validate_task_config_settings(raw_task_config_settings)  # type: ignore[assignment]
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    if update_data.mainLanguage is not None:
        settings.main_language = update_data.mainLanguage

    if update_data.subLanguages is not None:
        settings.sub_languages = update_data.subLanguages
        if settings.default_sub_language and settings.default_sub_language not in update_data.subLanguages:
            settings.default_sub_language = update_data.subLanguages[0] if update_data.subLanguages else None

    if "defaultSubLanguage" in update_data.model_fields_set:
        if update_data.defaultSubLanguage in (None, ""):
            settings.default_sub_language = None
        elif update_data.defaultSubLanguage in (settings.sub_languages or []):
            settings.default_sub_language = update_data.defaultSubLanguage

    if update_data.uiLanguage is not None:
        settings.ui_language = update_data.uiLanguage  # type: ignore[assignment]

    if update_data.theme is not None:
        settings.theme = update_data.theme

    if not demo_mode_enabled and update_data.retryConfig is not None:
        settings.retry_config = update_data.retryConfig.model_dump()  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.imageGenConfig is not None:
        settings.image_gen_config = update_data.imageGenConfig.model_dump()  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.customThinkingTemplates is not None:
        templates = []
        for template in update_data.customThinkingTemplates:
            item = template.model_dump()
            if not item.get("id"):
                item["id"] = str(uuid.uuid4())
            templates.append(item)
        settings.custom_thinking_templates = templates  # type: ignore[assignment]
        _cascade_clear_deleted_templates(settings, {item["id"] for item in templates if item.get("id")})

    if not demo_mode_enabled and update_data.nativeOutputMode is not None:
        settings.native_output_mode = update_data.nativeOutputMode  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.vectorStorageEnabled is not None:
        settings.vector_storage_enabled = update_data.vectorStorageEnabled  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.embeddingConfigs is not None:
        prev = merge_embedding_configs(getattr(settings, "embedding_configs", None))
        next_cfg = merge_embedding_configs(update_data.embeddingConfigs.model_dump(exclude_none=True))

        rag_prev = prev.get("ragSearch", {})
        rag_next = next_cfg.get("ragSearch", {})
        if rag_prev.get("provider") != rag_next.get("provider") or rag_prev.get("model") != rag_next.get("model"):
            wipe_user_index(db, user_id=current_user.id)
            rag_next["dimensions"] = None

        mem_prev = prev.get("agentMemory", {})
        mem_next = next_cfg.get("agentMemory", {})
        if mem_prev.get("provider") != mem_next.get("provider") or mem_prev.get("model") != mem_next.get("model"):
            wipe_memory_index(db, user_id=current_user.id)
            mem_next["dimensions"] = None

        settings.embedding_configs = next_cfg  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.ragSearchTopKPerQuery is not None:
        settings.rag_search_top_k_per_query = update_data.ragSearchTopKPerQuery  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.ragSearchNeighborWindow is not None:
        settings.rag_search_neighbor_window = update_data.ragSearchNeighborWindow  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.ragSearchMaxPrimaryChunks is not None:
        settings.rag_search_max_primary_chunks = update_data.ragSearchMaxPrimaryChunks  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.ragSearchMaxTotalChunks is not None:
        settings.rag_search_max_total_chunks = update_data.ragSearchMaxTotalChunks  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.ragSearchKeywordPageSize is not None:
        settings.rag_search_keyword_page_size = update_data.ragSearchKeywordPageSize  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.agentMemoryTopKPerQuery is not None:
        settings.agent_memory_top_k_per_query = update_data.agentMemoryTopKPerQuery  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.agentMemoryNeighborWindow is not None:
        settings.agent_memory_neighbor_window = update_data.agentMemoryNeighborWindow  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.agentMemoryMaxPrimaryMessages is not None:
        settings.agent_memory_max_primary_messages = update_data.agentMemoryMaxPrimaryMessages  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.agentMemoryMaxTotalMessages is not None:
        settings.agent_memory_max_total_messages = update_data.agentMemoryMaxTotalMessages  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.patchAutoRetry is not None:
        settings.patch_auto_retry = update_data.patchAutoRetry  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.llmLoggingEnabled is not None:
        settings.llm_logging_enabled = update_data.llmLoggingEnabled  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.toolCallHistoryLimit is not None:
        settings.tool_call_history_limit = update_data.toolCallHistoryLimit  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.thinkingHistoryLimit is not None:
        settings.thinking_history_limit = update_data.thinkingHistoryLimit  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.toolCallAutoApprove is not None:
        settings.tool_call_auto_approve = update_data.toolCallAutoApprove.model_dump()  # type: ignore[assignment]

    db.commit()
    db.refresh(settings)
    return _build_settings_response(settings)

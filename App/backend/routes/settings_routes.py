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
from ..providers.shared.image.settings import default_image_gen_config, validate_image_gen_config
from ..services.memory_service import wipe_memory_index
from ..services.semantic_index_service import wipe_user_semantic_index
from ..services.search_memory_settings import (
    clear_dimensions_for_target,
    resolve_memory_settings,
    resolve_search_settings,
    validate_search_memory_settings,
)
from ..services.settings_service import settings_service
from ..services.task_config_settings import validate_task_config_settings

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


def _build_tool_call_auto_approve(raw: object) -> dict[str, bool]:
    from ..services.tool_engine.module_loader import list_registered_auto_approve_categories

    stored = raw if isinstance(raw, dict) else {}
    return {
        category: bool(stored.get(category, False))
        for category in list_registered_auto_approve_categories()
    }

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
    image_gen_config_raw = getattr(settings, "image_gen_config", None) or deepcopy(default_image_gen_config())
    try:
        image_gen_config_dict = validate_image_gen_config(image_gen_config_raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stored image generation settings are invalid: {exc}",
        ) from exc
    tool_call_auto_approve_dict = _build_tool_call_auto_approve(getattr(settings, "tool_call_auto_approve", None))
    raw_search_memory_settings = getattr(settings, "search_memory_settings", None)
    if not isinstance(raw_search_memory_settings, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stored search memory settings are invalid.",
        )
    try:
        search_memory_settings = validate_search_memory_settings(raw_search_memory_settings)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stored search memory settings are invalid: {exc}",
        ) from exc
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
        searchMemorySettings=search_memory_settings,  # type: ignore[arg-type]
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
    prev_main_language = str(getattr(settings, "main_language", "English") or "English")
    prev_search_memory_settings = validate_search_memory_settings(getattr(settings, "search_memory_settings", None))
    prev_search_settings = resolve_search_settings(prev_search_memory_settings)
    prev_memory_settings = resolve_memory_settings(prev_search_memory_settings)
    should_wipe_semantic_index = False
    should_wipe_memory_index = False

    if not demo_mode_enabled and update_data.taskConfigSettings is not None:
        raw_task_config_settings = update_data.taskConfigSettings.model_dump(exclude_unset=True)
        try:
            settings.task_config_settings = validate_task_config_settings(raw_task_config_settings)  # type: ignore[assignment]
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    if update_data.mainLanguage is not None:
        settings.main_language = update_data.mainLanguage
        if update_data.mainLanguage != prev_main_language:
            should_wipe_semantic_index = True

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
        try:
            settings.image_gen_config = validate_image_gen_config(
                update_data.imageGenConfig.model_dump()
            )  # type: ignore[assignment]
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

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

    if not demo_mode_enabled and update_data.searchMemorySettings is not None:
        try:
            next_search_memory_settings = validate_search_memory_settings(
                update_data.searchMemorySettings.model_dump(mode="json")
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        next_search_settings = resolve_search_settings(next_search_memory_settings)
        next_memory_settings = resolve_memory_settings(next_search_memory_settings)

        prev_search_signature = (
            str(prev_search_settings["embedding"].get("provider") or ""),
            str(prev_search_settings["embedding"].get("model") or ""),
        )
        next_search_signature = (
            str(next_search_settings["embedding"].get("provider") or ""),
            str(next_search_settings["embedding"].get("model") or ""),
        )
        if prev_search_signature != next_search_signature:
            should_wipe_semantic_index = True
            next_search_memory_settings = clear_dimensions_for_target(next_search_memory_settings, "search")

        prev_memory_signature = (
            str(prev_memory_settings["embedding"].get("provider") or ""),
            str(prev_memory_settings["embedding"].get("model") or ""),
        )
        next_memory_signature = (
            str(next_memory_settings["embedding"].get("provider") or ""),
            str(next_memory_settings["embedding"].get("model") or ""),
        )
        if prev_memory_signature != next_memory_signature:
            should_wipe_memory_index = True
            next_search_memory_settings = clear_dimensions_for_target(next_search_memory_settings, "memory")

        settings.search_memory_settings = next_search_memory_settings  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.patchAutoRetry is not None:
        settings.patch_auto_retry = update_data.patchAutoRetry  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.llmLoggingEnabled is not None:
        settings.llm_logging_enabled = update_data.llmLoggingEnabled  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.toolCallHistoryLimit is not None:
        settings.tool_call_history_limit = update_data.toolCallHistoryLimit  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.thinkingHistoryLimit is not None:
        settings.thinking_history_limit = update_data.thinkingHistoryLimit  # type: ignore[assignment]

    if not demo_mode_enabled and update_data.toolCallAutoApprove is not None:
        settings.tool_call_auto_approve = _build_tool_call_auto_approve(update_data.toolCallAutoApprove)  # type: ignore[assignment]

    if should_wipe_semantic_index:
        wipe_user_semantic_index(db, user_id=current_user.id)
    if should_wipe_memory_index:
        wipe_memory_index(db, user_id=current_user.id)

    db.commit()
    db.refresh(settings)
    return _build_settings_response(settings)

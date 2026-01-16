"""API routes for user settings"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, Any

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User, UserSettings
from ..schemas.settings import (
    UserSettingsResponse,
    UserSettingsUpdate,
    FunctionAIConfig,
    ProviderCredentials,
    AIFunctionType,
    RetryConfig,
    ImageGenConfig
)

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.get("", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's settings"""

    # Get or create settings
    settings = db.query(UserSettings).filter(
        UserSettings.user_id == current_user.id
    ).first()

    if not settings:
        # Create default settings if not exists
        settings = UserSettings(
            user_id=current_user.id,
            function_configs={
                'agent': {
                    'provider': 'openrouter',
                    'model': 'gpt-5-mini',
                    'temperature': 0.7,
                    'advanced': {
                        'enablePrefill': False,
                        'thinkingMode': 'off',
                        'thinkingConfig': {'effort': 'medium'}
                    }
                },
                'translation': {
                    'provider': 'openrouter',
                    'model': 'gpt-5',
                    'temperature': 0.2,
                    'advanced': {
                        'enablePrefill': False,
                        'thinkingMode': 'off',
                        'thinkingConfig': {'effort': 'medium'}
                    }
                },
                'editAssistant': {
                    'provider': 'openrouter',
                    'model': 'gpt-5',
                    'temperature': 0.7,
                    'advanced': {
                        'enablePrefill': True,
                        'thinkingMode': 'off',
                        'thinkingConfig': {'effort': 'medium'}
                    }
                },
                'imagePrompt': {
                    'provider': 'openrouter',
                    'model': 'gpt-5',
                    'temperature': 0.7,
                    'advanced': {
                        'enablePrefill': False,
                        'thinkingMode': 'off',
                        'thinkingConfig': {'effort': 'medium'}
                    }
                }
            },
            provider_credentials={
                'openai': {'apiKey': ''},
                'gemini': {'apiKey': ''},
                'claude': {'apiKey': ''},
                'openrouter': {'apiKey': ''},
                'custom': {'baseUrl': '', 'apiKey': ''},
                'xai': {'apiKey': ''},
                'novelai': {'apiKey': ''}
            },
            provider_preferences={},
            main_language='English',
            sub_languages=[],
            default_sub_language=None
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)

    # Handle retry_config with default fallback for existing records
    retry_config_dict = getattr(settings, 'retry_config', None) or {
        "enabled": True,
        "maxRetries": 3,
        "retryableStatusCodes": [429, 500, 502, 503, 504],
        "retryDelayMs": 1000
    }

    # Handle image_gen_config with default fallback for existing records
    image_gen_config_dict = getattr(settings, 'image_gen_config', None) or {
        "provider": "openai",
        "model": "gpt-image-1",
        "size": "1024x1024",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "openaiSettings": {"quality": "standard", "style": "natural"},
        "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
        "novelaiSettings": {"sampler": "k_euler_ancestral", "steps": 28, "scale": 6.0, "noise_schedule": "karras"}
    }

    return UserSettingsResponse(
        functionConfigs=settings.function_configs,
        providerCredentials=settings.provider_credentials,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme,
        retryConfig=retry_config_dict,  # type: ignore
        imageGenConfig=image_gen_config_dict,  # type: ignore
        nativeOutputMode=settings.native_output_mode,
        patchAutoRetry=getattr(settings, 'patch_auto_retry', True),
        llmLoggingEnabled=getattr(settings, 'llm_logging_enabled', False),
        functionCallHistoryLimit=getattr(settings, 'function_call_history_limit', 5),
        thinkingHistoryLimit=getattr(settings, 'thinking_history_limit', 5),
        displayLanguage=getattr(settings, 'display_language', 'English')
    )


@router.put("", response_model=UserSettingsResponse)
async def update_user_settings(
    update_data: UserSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user settings"""

    settings = db.query(UserSettings).filter(
        UserSettings.user_id == current_user.id
    ).first()

    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Settings not found. Please get settings first."
        )

    # Update fields if provided
    if update_data.functionConfigs is not None:
        # Convert Pydantic models to dict for JSONB storage
        settings.function_configs = {
            k: v.model_dump(exclude_none=True)
            for k, v in update_data.functionConfigs.items()
        }

    if update_data.providerCredentials is not None:
        settings.provider_credentials = update_data.providerCredentials.model_dump()

    if update_data.mainLanguage is not None:
        settings.main_language = update_data.mainLanguage

    if update_data.subLanguages is not None:
        settings.sub_languages = update_data.subLanguages
        # Validate defaultSubLanguage is in subLanguages
        if settings.default_sub_language and settings.default_sub_language not in update_data.subLanguages:
            settings.default_sub_language = update_data.subLanguages[0] if update_data.subLanguages else None

    if update_data.defaultSubLanguage is not None:
        # Validate it's in subLanguages
        if update_data.defaultSubLanguage in (settings.sub_languages or []):
            settings.default_sub_language = update_data.defaultSubLanguage
    elif update_data.defaultSubLanguage == "":
        # Allow explicitly clearing the default
        settings.default_sub_language = None

    if update_data.theme is not None:
        settings.theme = update_data.theme

    if update_data.retryConfig is not None:
        settings.retry_config = update_data.retryConfig.model_dump()  # type: ignore

    if update_data.imageGenConfig is not None:
        settings.image_gen_config = update_data.imageGenConfig.model_dump()  # type: ignore

    if update_data.nativeOutputMode is not None:
        settings.native_output_mode = update_data.nativeOutputMode  # type: ignore

    if update_data.patchAutoRetry is not None:
        settings.patch_auto_retry = update_data.patchAutoRetry  # type: ignore

    if update_data.llmLoggingEnabled is not None:
        settings.llm_logging_enabled = update_data.llmLoggingEnabled  # type: ignore

    if update_data.functionCallHistoryLimit is not None:
        settings.function_call_history_limit = update_data.functionCallHistoryLimit  # type: ignore

    if update_data.thinkingHistoryLimit is not None:
        settings.thinking_history_limit = update_data.thinkingHistoryLimit  # type: ignore

    if update_data.displayLanguage is not None:
        settings.display_language = update_data.displayLanguage  # type: ignore

    db.commit()
    db.refresh(settings)

    # Handle retry_config with default fallback
    retry_config_dict = getattr(settings, 'retry_config', None) or {
        "enabled": True,
        "maxRetries": 3,
        "retryableStatusCodes": [429, 500, 502, 503, 504],
        "retryDelayMs": 1000
    }

    # Handle image_gen_config with default fallback
    image_gen_config_dict = getattr(settings, 'image_gen_config', None) or {
        "provider": "openai",
        "model": "gpt-image-1",
        "size": "1024x1024",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "openaiSettings": {"quality": "standard", "style": "natural"},
        "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
        "novelaiSettings": {"sampler": "k_euler_ancestral", "steps": 28, "scale": 6.0, "noise_schedule": "karras"}
    }

    return UserSettingsResponse(
        functionConfigs=settings.function_configs,
        providerCredentials=settings.provider_credentials,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme,
        retryConfig=retry_config_dict,  # type: ignore
        imageGenConfig=image_gen_config_dict,  # type: ignore
        nativeOutputMode=settings.native_output_mode,
        patchAutoRetry=getattr(settings, 'patch_auto_retry', True),
        llmLoggingEnabled=getattr(settings, 'llm_logging_enabled', False),
        functionCallHistoryLimit=getattr(settings, 'function_call_history_limit', 5),
        thinkingHistoryLimit=getattr(settings, 'thinking_history_limit', 5),
        displayLanguage=getattr(settings, 'display_language', 'English')
    )


@router.patch("/function/{function_type}", response_model=UserSettingsResponse)
async def update_function_config(
    function_type: AIFunctionType,
    config: FunctionAIConfig,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update configuration for a specific AI function"""

    settings = db.query(UserSettings).filter(
        UserSettings.user_id == current_user.id
    ).first()

    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Settings not found"
        )

    # Update specific function config
    function_configs = settings.function_configs.copy()
    function_configs[function_type.value] = config.model_dump(exclude_none=True)
    settings.function_configs = function_configs

    db.commit()
    db.refresh(settings)

    # Handle retry_config with default fallback
    retry_config_dict = getattr(settings, 'retry_config', None) or {
        "enabled": True,
        "maxRetries": 3,
        "retryableStatusCodes": [429, 500, 502, 503, 504],
        "retryDelayMs": 1000
    }

    # Handle image_gen_config with default fallback
    image_gen_config_dict = getattr(settings, 'image_gen_config', None) or {
        "provider": "openai",
        "model": "gpt-image-1",
        "size": "1024x1024",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "openaiSettings": {"quality": "standard", "style": "natural"},
        "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
        "novelaiSettings": {"sampler": "k_euler_ancestral", "steps": 28, "scale": 6.0, "noise_schedule": "karras"}
    }

    return UserSettingsResponse(
        functionConfigs=settings.function_configs,
        providerCredentials=settings.provider_credentials,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme,
        retryConfig=retry_config_dict,  # type: ignore
        imageGenConfig=image_gen_config_dict,  # type: ignore
        nativeOutputMode=settings.native_output_mode,
        patchAutoRetry=getattr(settings, 'patch_auto_retry', True),
        llmLoggingEnabled=getattr(settings, 'llm_logging_enabled', False),
        functionCallHistoryLimit=getattr(settings, 'function_call_history_limit', 5),
        thinkingHistoryLimit=getattr(settings, 'thinking_history_limit', 5),
        displayLanguage=getattr(settings, 'display_language', 'English')
    )


@router.post("/sync")
async def sync_settings_from_client(
    client_settings: Dict[str, Any],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Sync settings from client to server.
    Used when user makes changes offline or in localStorage.
    Returns the updated settings timestamp for conflict detection.
    """

    settings = db.query(UserSettings).filter(
        UserSettings.user_id == current_user.id
    ).first()

    # Default retry config
    default_retry_config = {
        "enabled": True,
        "maxRetries": 3,
        "retryableStatusCodes": [429, 500, 502, 503, 504],
        "retryDelayMs": 1000
    }

    # Default image gen config
    default_image_gen_config = {
        "provider": "openai",
        "model": "gpt-image-1",
        "size": "1024x1024",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "openaiSettings": {"quality": "standard", "style": "natural"},
        "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
        "novelaiSettings": {"sampler": "k_euler_ancestral", "steps": 28, "scale": 6.0, "noise_schedule": "karras"}
    }

    if not settings:
        # Create new settings from client data
        settings = UserSettings(
            user_id=current_user.id,
            function_configs=client_settings.get('functionConfigs', {}),
            provider_credentials=client_settings.get('providerCredentials', {}),
            main_language=client_settings.get('mainLanguage', 'English'),
            sub_languages=client_settings.get('subLanguages', []),
            default_sub_language=client_settings.get('defaultSubLanguage'),
            theme=client_settings.get('theme', 'system'),
            retry_config=client_settings.get('retryConfig', default_retry_config),
            image_gen_config=client_settings.get('imageGenConfig', default_image_gen_config),
            native_output_mode=client_settings.get('nativeOutputMode', False),
            patch_auto_retry=client_settings.get('patchAutoRetry', True),
            llm_logging_enabled=client_settings.get('llmLoggingEnabled', False),
            function_call_history_limit=client_settings.get('functionCallHistoryLimit', 5),
            thinking_history_limit=client_settings.get('thinkingHistoryLimit', 5),
            display_language=client_settings.get('displayLanguage', 'English')
        )
        db.add(settings)
    else:
        # Update existing settings
        settings.function_configs = client_settings.get('functionConfigs', settings.function_configs)  # type: ignore
        settings.provider_credentials = client_settings.get('providerCredentials', settings.provider_credentials)  # type: ignore
        settings.provider_preferences = client_settings.get('providerPreferences', settings.provider_preferences)  # type: ignore
        settings.main_language = client_settings.get('mainLanguage', settings.main_language)  # type: ignore
        settings.sub_languages = client_settings.get('subLanguages', settings.sub_languages)  # type: ignore
        settings.default_sub_language = client_settings.get('defaultSubLanguage', settings.default_sub_language)  # type: ignore
        settings.theme = client_settings.get('theme', settings.theme)  # type: ignore
        settings.retry_config = client_settings.get('retryConfig', settings.retry_config or default_retry_config)  # type: ignore
        settings.image_gen_config = client_settings.get('imageGenConfig', settings.image_gen_config or default_image_gen_config)  # type: ignore
        settings.native_output_mode = client_settings.get('nativeOutputMode', settings.native_output_mode)  # type: ignore
        settings.patch_auto_retry = client_settings.get('patchAutoRetry', getattr(settings, 'patch_auto_retry', True))  # type: ignore
        settings.llm_logging_enabled = client_settings.get('llmLoggingEnabled', getattr(settings, 'llm_logging_enabled', False))  # type: ignore
        settings.function_call_history_limit = client_settings.get('functionCallHistoryLimit', getattr(settings, 'function_call_history_limit', 5))  # type: ignore
        settings.thinking_history_limit = client_settings.get('thinkingHistoryLimit', getattr(settings, 'thinking_history_limit', 5))  # type: ignore
        settings.display_language = client_settings.get('displayLanguage', getattr(settings, 'display_language', 'English'))  # type: ignore

    db.commit()
    db.refresh(settings)

    return {
        "status": "synced",
        "updated_at": settings.updated_at.isoformat()
    }

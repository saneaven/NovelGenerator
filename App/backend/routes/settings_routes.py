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
    AIFunctionType
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
                'chat': {
                    'provider': 'openrouter',
                    'model': 'gpt-4o-mini',
                    'temperature': 0.7,
                    'advanced': {
                        'enablePrefill': False,
                        'thinkingMode': 'off',
                        'thinkingConfig': {'effort': 'medium'}
                    }
                },
                'translation': {
                    'provider': 'openrouter',
                    'model': 'gpt-4o',
                    'temperature': 0.2,
                    'advanced': {
                        'enablePrefill': False,
                        'thinkingMode': 'off',
                        'thinkingConfig': {'effort': 'medium'}
                    }
                },
                'storyEdit': {
                    'provider': 'openrouter',
                    'model': 'gpt-4o',
                    'temperature': 0.3,
                    'advanced': {
                        'enablePrefill': False,
                        'thinkingMode': 'off',
                        'thinkingConfig': {'effort': 'medium'}
                    }
                },
                'chapterGen': {
                    'provider': 'openrouter',
                    'model': 'gpt-4o',
                    'temperature': 0.7,
                    'advanced': {
                        'enablePrefill': True,
                        'thinkingMode': 'off',
                        'thinkingConfig': {'effort': 'medium'}
                    }
                }
            },
            provider_credentials={
                'openrouter': {'apiKey': ''},
                'custom': {'baseUrl': '', 'apiKey': ''},
                'claude': {'apiKey': ''},
                'gemini': {'apiKey': '', 'baseUrl': None},
                'openai': {'apiKey': ''}
            },
            provider_preferences={},
            main_language='English',
            sub_languages=[],
            default_sub_language=None
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return UserSettingsResponse(
        functionConfigs=settings.function_configs,
        providerCredentials=settings.provider_credentials,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme
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

    db.commit()
    db.refresh(settings)

    return UserSettingsResponse(
        functionConfigs=settings.function_configs,
        providerCredentials=settings.provider_credentials,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme
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

    return UserSettingsResponse(
        functionConfigs=settings.function_configs,
        providerCredentials=settings.provider_credentials,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme
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

    if not settings:
        # Create new settings from client data
        settings = UserSettings(
            user_id=current_user.id,
            function_configs=client_settings.get('functionConfigs', {}),
            provider_credentials=client_settings.get('providerCredentials', {}),
            main_language=client_settings.get('mainLanguage', 'English'),
            sub_languages=client_settings.get('subLanguages', []),
            default_sub_language=client_settings.get('defaultSubLanguage'),
            theme=client_settings.get('theme', 'system')
        )
        db.add(settings)
    else:
        # Update existing settings
        settings.function_configs = client_settings.get('functionConfigs', settings.function_configs)
        settings.provider_credentials = client_settings.get('providerCredentials', settings.provider_credentials)
        settings.provider_preferences = client_settings.get('providerPreferences', settings.provider_preferences)
        settings.main_language = client_settings.get('mainLanguage', settings.main_language)
        settings.sub_languages = client_settings.get('subLanguages', settings.sub_languages)
        settings.default_sub_language = client_settings.get('defaultSubLanguage', settings.default_sub_language)
        settings.theme = client_settings.get('theme', settings.theme)

    db.commit()
    db.refresh(settings)

    return {
        "status": "synced",
        "updated_at": settings.updated_at.isoformat()
    }

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
    TaskAIConfig,
    AITaskType,
    RetryConfig,
    ImageGenConfig,
)
from ..services.agent_memory_service import wipe_agent_memory_index
from ..services.embedding_config_service import merge_embedding_configs
from ..services.rag_index_service import wipe_user_index

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
            task_configs={
                'agent': {
                    'provider': 'openrouter',
                    'model': 'gpt-5-mini',
                    'temperature': 0.7,
                    'advanced': {
                        'enable_prefill': False,
                        'thinking_mode': 'off',
                        'thinking_config': {'effort': 'medium'},
                        'request_format': 'openai_sdk',
                        'thinking_format': 'openai',
                    },
                },
                'subAgent': {
                    'provider': 'openrouter',
                    'model': 'gpt-5-mini',
                    'temperature': 0.7,
                    'advanced': {
                        'enable_prefill': False,
                        'thinking_mode': 'off',
                        'thinking_config': {'effort': 'medium'},
                        'request_format': 'openai_sdk',
                        'thinking_format': 'openai',
                    },
                },
                'translation': {
                    'provider': 'openrouter',
                    'model': 'gpt-5',
                    'temperature': 0.2,
                    'advanced': {
                        'enable_prefill': False,
                        'thinking_mode': 'off',
                        'thinking_config': {'effort': 'medium'},
                        'request_format': 'openai_sdk',
                        'thinking_format': 'openai',
                    },
                },
                'editAssistant': {
                    'provider': 'openrouter',
                    'model': 'gpt-5',
                    'temperature': 0.7,
                    'advanced': {
                        'enable_prefill': True,
                        'thinking_mode': 'off',
                        'thinking_config': {'effort': 'medium'},
                        'request_format': 'openai_sdk',
                        'thinking_format': 'openai',
                    },
                },
                'imagePrompt': {
                    'provider': 'openrouter',
                    'model': 'gpt-5',
                    'temperature': 0.7,
                    'advanced': {
                        'enable_prefill': False,
                        'thinking_mode': 'off',
                        'thinking_config': {'effort': 'medium'},
                        'request_format': 'openai_sdk',
                        'thinking_format': 'openai',
                    },
                },
                'summary': {
                    'provider': 'openrouter',
                    'model': 'gpt-5-mini',
                    'temperature': 0.2,
                    'advanced': {
                        'enable_prefill': False,
                        'thinking_mode': 'off',
                        'thinking_config': {'effort': 'medium'},
                        'request_format': 'openai_sdk',
                        'thinking_format': 'openai',
                    },
                },
            },
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
        task_configs=settings.task_configs,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme,
        retryConfig=retry_config_dict,  # type: ignore
        imageGenConfig=image_gen_config_dict,  # type: ignore
        nativeOutputMode=settings.native_output_mode,
        ragSearchEnabled=getattr(settings, "rag_search_enabled", False),
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
        patchAutoRetry=getattr(settings, 'patch_auto_retry', True),
        llmLoggingEnabled=getattr(settings, 'llm_logging_enabled', False),
        toolCallHistoryLimit=getattr(settings, 'tool_call_history_limit', 5),
        thinkingHistoryLimit=getattr(settings, 'thinking_history_limit', 5),
        toolCallAutoApprove=tool_call_auto_approve_dict,
        uiLanguage=getattr(settings, 'ui_language', 'en')
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
    if update_data.task_configs is not None:
        # Convert Pydantic models to dict for JSONB storage
        settings.task_configs = {
            k: v.model_dump(exclude_none=True)
            for k, v in update_data.task_configs.items()
        }

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

    if update_data.ragSearchEnabled is not None:
        settings.rag_search_enabled = update_data.ragSearchEnabled  # type: ignore

    if update_data.embeddingConfigs is not None:
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
            wipe_agent_memory_index(db, user_id=current_user.id)
            mem_next["dimensions"] = None

        settings.embedding_configs = next_cfg  # type: ignore

    if update_data.ragSearchTopKPerQuery is not None:
        settings.rag_search_top_k_per_query = update_data.ragSearchTopKPerQuery  # type: ignore

    if update_data.ragSearchNeighborWindow is not None:
        settings.rag_search_neighbor_window = update_data.ragSearchNeighborWindow  # type: ignore

    if update_data.ragSearchMaxPrimaryChunks is not None:
        settings.rag_search_max_primary_chunks = update_data.ragSearchMaxPrimaryChunks  # type: ignore

    if update_data.ragSearchMaxTotalChunks is not None:
        settings.rag_search_max_total_chunks = update_data.ragSearchMaxTotalChunks  # type: ignore

    if update_data.ragSearchKeywordPageSize is not None:
        settings.rag_search_keyword_page_size = update_data.ragSearchKeywordPageSize  # type: ignore

    if update_data.agentMemoryTopKPerQuery is not None:
        settings.agent_memory_top_k_per_query = update_data.agentMemoryTopKPerQuery  # type: ignore

    if update_data.agentMemoryNeighborWindow is not None:
        settings.agent_memory_neighbor_window = update_data.agentMemoryNeighborWindow  # type: ignore

    if update_data.agentMemoryMaxPrimaryMessages is not None:
        settings.agent_memory_max_primary_messages = update_data.agentMemoryMaxPrimaryMessages  # type: ignore

    if update_data.agentMemoryMaxTotalMessages is not None:
        settings.agent_memory_max_total_messages = update_data.agentMemoryMaxTotalMessages  # type: ignore

    if update_data.patchAutoRetry is not None:
        settings.patch_auto_retry = update_data.patchAutoRetry  # type: ignore

    if update_data.llmLoggingEnabled is not None:
        settings.llm_logging_enabled = update_data.llmLoggingEnabled  # type: ignore

    if update_data.toolCallHistoryLimit is not None:
        settings.tool_call_history_limit = update_data.toolCallHistoryLimit  # type: ignore

    if update_data.thinkingHistoryLimit is not None:
        settings.thinking_history_limit = update_data.thinkingHistoryLimit  # type: ignore

    if update_data.toolCallAutoApprove is not None:
        settings.tool_call_auto_approve = update_data.toolCallAutoApprove.model_dump()  # type: ignore

    if update_data.uiLanguage is not None:
        settings.ui_language = update_data.uiLanguage  # type: ignore

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
        task_configs=settings.task_configs,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme,
        retryConfig=retry_config_dict,  # type: ignore
        imageGenConfig=image_gen_config_dict,  # type: ignore
        nativeOutputMode=settings.native_output_mode,
        ragSearchEnabled=getattr(settings, "rag_search_enabled", False),
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
        patchAutoRetry=getattr(settings, 'patch_auto_retry', True),
        llmLoggingEnabled=getattr(settings, 'llm_logging_enabled', False),
        toolCallHistoryLimit=getattr(settings, 'tool_call_history_limit', 5),
        thinkingHistoryLimit=getattr(settings, 'thinking_history_limit', 5),
        toolCallAutoApprove=tool_call_auto_approve_dict,
        uiLanguage=getattr(settings, 'ui_language', 'en')
    )


@router.patch("/task/{task_type}", response_model=UserSettingsResponse)
async def update_task_config(
    task_type: AITaskType,
    config: TaskAIConfig,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update configuration for a specific AI task"""

    settings = db.query(UserSettings).filter(
        UserSettings.user_id == current_user.id
    ).first()

    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Settings not found"
        )

    # Update specific task config
    task_configs = settings.task_configs.copy()
    task_configs[task_type.value] = config.model_dump(exclude_none=True)
    settings.task_configs = task_configs

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
        task_configs=settings.task_configs,
        mainLanguage=settings.main_language,
        subLanguages=settings.sub_languages or [],
        defaultSubLanguage=settings.default_sub_language,
        theme=settings.theme,
        retryConfig=retry_config_dict,  # type: ignore
        imageGenConfig=image_gen_config_dict,  # type: ignore
        nativeOutputMode=settings.native_output_mode,
        ragSearchEnabled=getattr(settings, "rag_search_enabled", False),
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
        patchAutoRetry=getattr(settings, 'patch_auto_retry', True),
        llmLoggingEnabled=getattr(settings, 'llm_logging_enabled', False),
        toolCallHistoryLimit=getattr(settings, 'tool_call_history_limit', 5),
        thinkingHistoryLimit=getattr(settings, 'thinking_history_limit', 5),
        toolCallAutoApprove=tool_call_auto_approve_dict,
        uiLanguage=getattr(settings, 'ui_language', 'en')
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
        embedding_configs = merge_embedding_configs(client_settings.get("embeddingConfigs"))
        settings = UserSettings(
            user_id=current_user.id,
            task_configs=client_settings.get('task_configs', {}),
            main_language=client_settings.get('mainLanguage', 'English'),
            sub_languages=client_settings.get('subLanguages', []),
            default_sub_language=client_settings.get('defaultSubLanguage'),
            theme=client_settings.get('theme', 'system'),
            retry_config=client_settings.get('retryConfig', default_retry_config),
            image_gen_config=client_settings.get('imageGenConfig', default_image_gen_config),
            native_output_mode=client_settings.get('nativeOutputMode', False),
            rag_search_enabled=client_settings.get('ragSearchEnabled', False),
            embedding_configs=embedding_configs,
            rag_search_top_k_per_query=client_settings.get('ragSearchTopKPerQuery', 20),
            rag_search_neighbor_window=client_settings.get('ragSearchNeighborWindow', 0),
            rag_search_max_primary_chunks=client_settings.get('ragSearchMaxPrimaryChunks', 20),
            rag_search_max_total_chunks=client_settings.get('ragSearchMaxTotalChunks', 60),
            rag_search_keyword_page_size=client_settings.get('ragSearchKeywordPageSize', 20),
            agent_memory_top_k_per_query=client_settings.get('agentMemoryTopKPerQuery', 20),
            agent_memory_neighbor_window=client_settings.get('agentMemoryNeighborWindow', 0),
            agent_memory_max_primary_messages=client_settings.get('agentMemoryMaxPrimaryMessages', 20),
            agent_memory_max_total_messages=client_settings.get('agentMemoryMaxTotalMessages', 60),
            patch_auto_retry=client_settings.get('patchAutoRetry', True),
            llm_logging_enabled=client_settings.get('llmLoggingEnabled', False),
            tool_call_history_limit=client_settings.get('toolCallHistoryLimit', 5),
            thinking_history_limit=client_settings.get('thinkingHistoryLimit', 5),
            tool_call_auto_approve=client_settings.get('toolCallAutoApprove', {
                "create": False,
                "delete": False,
                "patch": False,
                "replace": False,
                "read": False,
                "search": False,
                "subAgent": False,
            }),
            ui_language=client_settings.get('uiLanguage', 'en')
        )
        db.add(settings)
    else:
        # Update existing settings
        settings.task_configs = client_settings.get('task_configs', settings.task_configs)  # type: ignore
        settings.main_language = client_settings.get('mainLanguage', settings.main_language)  # type: ignore
        settings.sub_languages = client_settings.get('subLanguages', settings.sub_languages)  # type: ignore
        settings.default_sub_language = client_settings.get('defaultSubLanguage', settings.default_sub_language)  # type: ignore
        settings.theme = client_settings.get('theme', settings.theme)  # type: ignore
        settings.retry_config = client_settings.get('retryConfig', settings.retry_config or default_retry_config)  # type: ignore
        settings.image_gen_config = client_settings.get('imageGenConfig', settings.image_gen_config or default_image_gen_config)  # type: ignore
        settings.native_output_mode = client_settings.get('nativeOutputMode', settings.native_output_mode)  # type: ignore
        settings.rag_search_enabled = client_settings.get('ragSearchEnabled', getattr(settings, 'rag_search_enabled', False))  # type: ignore
        settings.rag_search_top_k_per_query = client_settings.get('ragSearchTopKPerQuery', getattr(settings, 'rag_search_top_k_per_query', 20))  # type: ignore
        settings.rag_search_neighbor_window = client_settings.get('ragSearchNeighborWindow', getattr(settings, 'rag_search_neighbor_window', 0))  # type: ignore
        settings.rag_search_max_primary_chunks = client_settings.get('ragSearchMaxPrimaryChunks', getattr(settings, 'rag_search_max_primary_chunks', 20))  # type: ignore
        settings.rag_search_max_total_chunks = client_settings.get('ragSearchMaxTotalChunks', getattr(settings, 'rag_search_max_total_chunks', 60))  # type: ignore
        settings.rag_search_keyword_page_size = client_settings.get('ragSearchKeywordPageSize', getattr(settings, 'rag_search_keyword_page_size', 20))  # type: ignore
        settings.agent_memory_top_k_per_query = client_settings.get('agentMemoryTopKPerQuery', getattr(settings, 'agent_memory_top_k_per_query', 20))  # type: ignore
        settings.agent_memory_neighbor_window = client_settings.get('agentMemoryNeighborWindow', getattr(settings, 'agent_memory_neighbor_window', 0))  # type: ignore
        settings.agent_memory_max_primary_messages = client_settings.get('agentMemoryMaxPrimaryMessages', getattr(settings, 'agent_memory_max_primary_messages', 20))  # type: ignore
        settings.agent_memory_max_total_messages = client_settings.get('agentMemoryMaxTotalMessages', getattr(settings, 'agent_memory_max_total_messages', 60))  # type: ignore
        settings.patch_auto_retry = client_settings.get('patchAutoRetry', getattr(settings, 'patch_auto_retry', True))  # type: ignore
        settings.llm_logging_enabled = client_settings.get('llmLoggingEnabled', getattr(settings, 'llm_logging_enabled', False))  # type: ignore
        settings.tool_call_history_limit = client_settings.get('toolCallHistoryLimit', getattr(settings, 'tool_call_history_limit', 5))  # type: ignore
        settings.thinking_history_limit = client_settings.get('thinkingHistoryLimit', getattr(settings, 'thinking_history_limit', 5))  # type: ignore
        settings.tool_call_auto_approve = client_settings.get('toolCallAutoApprove', getattr(settings, 'tool_call_auto_approve', {
            "create": False,
            "delete": False,
            "patch": False,
            "replace": False,
            "read": False,
            "search": False,
            "subAgent": False,
        }))  # type: ignore
        settings.ui_language = client_settings.get('uiLanguage', getattr(settings, 'ui_language', 'en'))  # type: ignore

        if "embeddingConfigs" in client_settings:
            prev = merge_embedding_configs(getattr(settings, "embedding_configs", None))
            next_cfg = merge_embedding_configs(client_settings.get("embeddingConfigs"))

            rag_prev = prev.get("ragSearch", {})
            rag_next = next_cfg.get("ragSearch", {})
            if rag_prev.get("provider") != rag_next.get("provider") or rag_prev.get("model") != rag_next.get("model"):
                wipe_user_index(db, user_id=current_user.id)
                rag_next["dimensions"] = None

            mem_prev = prev.get("agentMemory", {})
            mem_next = next_cfg.get("agentMemory", {})
            if mem_prev.get("provider") != mem_next.get("provider") or mem_prev.get("model") != mem_next.get("model"):
                wipe_agent_memory_index(db, user_id=current_user.id)
                mem_next["dimensions"] = None

            settings.embedding_configs = next_cfg  # type: ignore

    db.commit()
    db.refresh(settings)

    return {
        "status": "synced",
        "updated_at": settings.updated_at.isoformat()
    }

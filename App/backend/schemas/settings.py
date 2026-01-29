"""Pydantic schemas for user settings"""
from pydantic import BaseModel, Field
from typing import Optional, Dict, List
from enum import Enum


class ProviderType(str, Enum):
    """AI provider types"""
    OPENAI = "openai"
    GEMINI = "gemini"
    CLAUDE = "claude"
    OPENROUTER = "openrouter"
    CUSTOM = "custom"
    XAI = "xai"


class EmbeddingProviderType(str, Enum):
    """Embedding provider types (subset of ProviderType)."""

    OPENAI = "openai"
    GEMINI = "gemini"
    OPENROUTER = "openrouter"
    CUSTOM = "custom"


class AITaskType(str, Enum):
    """AI task types"""
    AGENT = "agent"
    TRANSLATION = "translation"
    EDIT_ASSISTANT = "editAssistant"
    IMAGE_PROMPT = "imagePrompt"
    SUMMARY = "summary"


class ProviderPreference(BaseModel):
    """OpenRouter provider filtering"""
    only: Optional[List[str]] = None
    ignore: Optional[List[str]] = None


class ThinkingConfig(BaseModel):
    """Thinking configuration for model-native thinking"""
    effort: Optional[str] = "medium"  # legacy OpenRouter-style effort
    maxTokens: Optional[int] = None
    verbosity: Optional[str] = None  # GPT-5 output verbosity: 'low' | 'medium' | 'high'
    claudeBudgetTokens: Optional[int] = None
    geminiThinkingLevel: Optional[str] = None  # 'minimal' | 'low' | 'medium' | 'high'
    geminiBudgetTokens: Optional[int] = None


class AdvancedTaskSettings(BaseModel):
    """Advanced settings for AI tasks"""
    enablePrefill: bool = False
    thinkingMode: str = "off"  # 'off' | 'model' | 'custom'
    thinkingConfig: Optional[ThinkingConfig] = Field(default_factory=lambda: ThinkingConfig())
    customApiFormat: str = "openai"  # 'openai' | 'claude' | 'gemini' | 'openrouter' - for custom provider
    tokenizerOverride: Optional[str] = None  # 'openai' | 'claude' | 'gemini' (used for token counting)


class TaskAIConfig(BaseModel):
    """Configuration for a specific AI task"""
    provider: ProviderType
    model: str = Field(..., min_length=1, max_length=200)
    temperature: float = Field(default=0.7, ge=0, le=2)
    providerPreference: Optional[ProviderPreference] = None
    # Max output tokens for the response (maps to backend `max_tokens`).
    # Leave unset to use provider defaults.
    maxOutputTokens: Optional[int] = Field(default=None, ge=1, le=1000000)
    # Context window upper bound used for local prompt budgeting (e.g. agent memory preflight).
    contextWindowTokens: Optional[int] = Field(default=None, ge=1024, le=1000000)
    advanced: AdvancedTaskSettings = Field(default_factory=AdvancedTaskSettings)

    class Config:
        use_enum_values = True


class OpenRouterCredentials(BaseModel):
    """OpenRouter credentials"""
    apiKey: str = ""


class CustomCredentials(BaseModel):
    """Custom endpoint credentials"""
    baseUrl: str = ""
    apiKey: Optional[str] = ""


class ClaudeCredentials(BaseModel):
    """Claude (Anthropic) credentials"""
    apiKey: str = ""


class GeminiCredentials(BaseModel):
    """Gemini (Google) credentials"""
    apiKey: str = ""


class OpenAICredentials(BaseModel):
    """OpenAI credentials"""
    apiKey: str = ""


class XAICredentials(BaseModel):
    """xAI (Grok) credentials"""
    apiKey: str = ""


class NovelAICredentials(BaseModel):
    """NovelAI credentials"""
    apiKey: str = ""


class ProviderCredentials(BaseModel):
    """All provider credentials"""
    openai: OpenAICredentials = Field(default_factory=OpenAICredentials)
    gemini: GeminiCredentials = Field(default_factory=GeminiCredentials)
    claude: ClaudeCredentials = Field(default_factory=ClaudeCredentials)
    openrouter: OpenRouterCredentials = Field(default_factory=OpenRouterCredentials)
    custom: CustomCredentials = Field(default_factory=CustomCredentials)
    xai: XAICredentials = Field(default_factory=XAICredentials)
    novelai: NovelAICredentials = Field(default_factory=NovelAICredentials)


class ThemeMode(str, Enum):
    """Theme mode options"""
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class RetryConfig(BaseModel):
    """Retry configuration for error handling"""
    enabled: bool = True
    maxRetries: int = Field(default=3, ge=0, le=10)
    retryableStatusCodes: List[int] = Field(default=[429, 500, 502, 503, 504])
    retryDelayMs: int = Field(default=1000, ge=100, le=30000)


class ToolCallAutoApprove(BaseModel):
    """Tool call auto-approve configuration (all-or-none per assistant response)."""
    create: bool = False
    delete: bool = False
    patch: bool = False
    replace: bool = False
    read: bool = False
    search: bool = False


# Embedding settings
class EmbeddingProfileConfig(BaseModel):
    """Embedding profile configuration used by RAG Search / Agent Memory."""

    provider: EmbeddingProviderType = EmbeddingProviderType.OPENAI
    model: str = Field(default="", max_length=200)
    dimensions: Optional[int] = None

    class Config:
        use_enum_values = True


class EmbeddingConfigs(BaseModel):
    """Embedding profiles by feature."""

    ragSearch: EmbeddingProfileConfig = Field(default_factory=EmbeddingProfileConfig)
    agentMemory: EmbeddingProfileConfig = Field(default_factory=EmbeddingProfileConfig)


# Image generation settings schemas
class NaturalImageStyle(BaseModel):
    """Custom image style for natural language providers (prefix/postfix)"""
    id: str
    name: str
    prefix: str = ""
    postfix: str = ""


class TagBasedImageStyle(BaseModel):
    """Custom image style for tag-based providers (prefix/postfix for positive and negative prompts)"""
    id: str
    name: str
    positivePrefix: str = ""
    positivePostfix: str = ""
    negativePrefix: str = ""
    negativePostfix: str = ""


class OpenAIImageSettings(BaseModel):
    """OpenAI-specific image settings"""
    quality: str = "standard"
    style: str = "natural"


class GeminiImageSettings(BaseModel):
    """Gemini-specific image settings (uses aspect_ratio + image_size)"""
    aspect_ratio: str = "1:1"
    image_resolution: str = "2K"


class NovelAIImageSettings(BaseModel):
    """NovelAI-specific image settings"""
    sampler: str = "k_euler_ancestral"
    steps: int = 28
    scale: float = 6.0
    noise_schedule: str = "karras"


class ImageGenConfig(BaseModel):
    """Image generation configuration"""
    provider: str = "openai"
    model: str = "gpt-image-1"
    size: str = "1024x1024"
    naturalStyles: List[NaturalImageStyle] = []
    tagBasedStyles: List[TagBasedImageStyle] = []
    selectedNaturalStyleId: Optional[str] = None
    selectedTagBasedStyleId: Optional[str] = None
    openaiSettings: OpenAIImageSettings = Field(default_factory=OpenAIImageSettings)
    geminiSettings: GeminiImageSettings = Field(default_factory=GeminiImageSettings)
    novelaiSettings: NovelAIImageSettings = Field(default_factory=NovelAIImageSettings)


class UserSettingsResponse(BaseModel):
    """User settings response"""
    taskConfigs: Dict[str, TaskAIConfig]
    mainLanguage: str
    subLanguages: List[str] = []
    defaultSubLanguage: Optional[str] = None
    theme: str = "system"
    retryConfig: RetryConfig = Field(default_factory=RetryConfig)
    imageGenConfig: ImageGenConfig = Field(default_factory=ImageGenConfig)
    nativeOutputMode: bool = False
    ragSearchEnabled: bool = False
    embeddingConfigs: EmbeddingConfigs = Field(default_factory=EmbeddingConfigs)
    ragSearchTopKPerQuery: int = Field(default=20, ge=1, le=200)
    ragSearchNeighborWindow: int = Field(default=0, ge=0, le=20)
    ragSearchMaxPrimaryChunks: int = Field(default=20, ge=1, le=200)
    ragSearchMaxTotalChunks: int = Field(default=60, ge=1, le=500)
    agentMemoryTopKPerQuery: int = Field(default=20, ge=1, le=200)
    agentMemoryNeighborWindow: int = Field(default=0, ge=0, le=20)
    agentMemoryMaxPrimaryMessages: int = Field(default=20, ge=1, le=200)
    agentMemoryMaxTotalMessages: int = Field(default=60, ge=1, le=500)
    patchAutoRetry: bool = True
    llmLoggingEnabled: bool = False
    toolCallHistoryLimit: int = 5
    thinkingHistoryLimit: int = 5
    toolCallAutoApprove: ToolCallAutoApprove = Field(default_factory=ToolCallAutoApprove)
    displayLanguage: str = "English"
    uiLanguage: str = "en"

    class Config:
        from_attributes = True


class UserSettingsUpdate(BaseModel):
    """Update user settings"""
    taskConfigs: Optional[Dict[str, TaskAIConfig]] = None
    mainLanguage: Optional[str] = None
    subLanguages: Optional[List[str]] = None
    defaultSubLanguage: Optional[str] = None
    theme: Optional[str] = None
    retryConfig: Optional[RetryConfig] = None
    imageGenConfig: Optional[ImageGenConfig] = None
    nativeOutputMode: Optional[bool] = None
    ragSearchEnabled: Optional[bool] = None
    embeddingConfigs: Optional[EmbeddingConfigs] = None
    ragSearchTopKPerQuery: Optional[int] = Field(default=None, ge=1, le=200)
    ragSearchNeighborWindow: Optional[int] = Field(default=None, ge=0, le=20)
    ragSearchMaxPrimaryChunks: Optional[int] = Field(default=None, ge=1, le=200)
    ragSearchMaxTotalChunks: Optional[int] = Field(default=None, ge=1, le=500)
    agentMemoryTopKPerQuery: Optional[int] = Field(default=None, ge=1, le=200)
    agentMemoryNeighborWindow: Optional[int] = Field(default=None, ge=0, le=20)
    agentMemoryMaxPrimaryMessages: Optional[int] = Field(default=None, ge=1, le=200)
    agentMemoryMaxTotalMessages: Optional[int] = Field(default=None, ge=1, le=500)
    patchAutoRetry: Optional[bool] = None
    llmLoggingEnabled: Optional[bool] = None
    toolCallHistoryLimit: Optional[int] = None
    thinkingHistoryLimit: Optional[int] = None
    toolCallAutoApprove: Optional[ToolCallAutoApprove] = None
    displayLanguage: Optional[str] = None
    uiLanguage: Optional[str] = None

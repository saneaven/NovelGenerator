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


class AIFunctionType(str, Enum):
    """AI function types"""
    AGENT = "agent"
    TRANSLATION = "translation"
    EDIT_ASSISTANT = "editAssistant"
    IMAGE_PROMPT = "imagePrompt"


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


class AdvancedFunctionSettings(BaseModel):
    """Advanced settings for AI functions"""
    enablePrefill: bool = False
    thinkingMode: str = "off"  # 'off' | 'model' | 'custom'
    thinkingConfig: Optional[ThinkingConfig] = Field(default_factory=lambda: ThinkingConfig())
    customApiFormat: str = "openai"  # 'openai' | 'claude' | 'gemini' | 'openrouter' - for custom provider


class FunctionAIConfig(BaseModel):
    """Configuration for a specific AI function"""
    provider: ProviderType
    model: str = Field(..., min_length=1, max_length=200)
    temperature: float = Field(default=0.7, ge=0, le=2)
    providerPreference: Optional[ProviderPreference] = None
    advanced: AdvancedFunctionSettings = Field(default_factory=AdvancedFunctionSettings)

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
    functionConfigs: Dict[str, FunctionAIConfig]
    providerCredentials: ProviderCredentials
    mainLanguage: str
    subLanguages: List[str] = []
    defaultSubLanguage: Optional[str] = None
    theme: str = "system"
    retryConfig: RetryConfig = Field(default_factory=RetryConfig)
    imageGenConfig: ImageGenConfig = Field(default_factory=ImageGenConfig)
    nativeOutputMode: bool = False
    patchAutoRetry: bool = True
    llmLoggingEnabled: bool = False
    functionCallHistoryLimit: int = 5
    displayLanguage: str = "English"

    class Config:
        from_attributes = True


class UserSettingsUpdate(BaseModel):
    """Update user settings"""
    functionConfigs: Optional[Dict[str, FunctionAIConfig]] = None
    providerCredentials: Optional[ProviderCredentials] = None
    mainLanguage: Optional[str] = None
    subLanguages: Optional[List[str]] = None
    defaultSubLanguage: Optional[str] = None
    theme: Optional[str] = None
    retryConfig: Optional[RetryConfig] = None
    imageGenConfig: Optional[ImageGenConfig] = None
    nativeOutputMode: Optional[bool] = None
    patchAutoRetry: Optional[bool] = None
    llmLoggingEnabled: Optional[bool] = None
    functionCallHistoryLimit: Optional[int] = None
    displayLanguage: Optional[str] = None

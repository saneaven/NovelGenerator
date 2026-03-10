"""Pydantic schemas for user settings"""
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional, Dict, List, Literal
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
    SUB_AGENT = "subAgent"


class ProviderPreference(BaseModel):
    """OpenRouter provider filtering"""
    model_config = ConfigDict(extra="forbid")

    only: Optional[List[str]] = None
    ignore: Optional[List[str]] = None


class ThinkingConfig(BaseModel):
    """Thinking configuration for model-native thinking"""
    model_config = ConfigDict(extra="forbid")

    effort: Optional[Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]] = None
    max_tokens: Optional[int] = None
    gemini_thinking_level: Optional[str] = None  # 'minimal' | 'low' | 'medium' | 'high'
    gemini_budget_tokens: Optional[int] = None


class CustomThinkingEffortField(BaseModel):
    """A single effort field: a dot-path into the request body and the value to inject."""
    path: str
    value: str


class CustomThinkingResponseField(BaseModel):
    """A single response field: a dot-path in the SSE delta to extract."""
    path: str
    as_var: str
    is_stream_delta: bool = False


class CustomThinkingHistoryField(BaseModel):
    """A single history field: how to inject a stored variable back into assistant messages."""
    path: str
    in_var: str


class CustomThinkingTemplate(BaseModel):
    """User-defined thinking template for custom providers."""
    model_config = ConfigDict(extra="forbid")

    id: Optional[str] = None
    name: str
    effort_fields: List[CustomThinkingEffortField] = []
    response_fields: List[CustomThinkingResponseField] = []
    history_fields: List[CustomThinkingHistoryField] = []


class AdvancedTaskSettings(BaseModel):
    """Advanced settings for AI tasks"""
    model_config = ConfigDict(extra="forbid")

    thinking_mode: Literal["off", "model", "custom"]
    thinking_config: Optional[ThinkingConfig] = None
    custom_thinking_template_id: Optional[str] = None
    tokenizer_override: Optional[Literal["openai", "claude", "gemini"]] = None
    request_format: Optional[Literal["openai_sdk", "claude_sdk", "openai_responses"]] = None
    verbosity: Optional[Literal["low", "medium", "high"]] = None  # GPT-5 output verbosity (text.verbosity in Responses API)


class TaskAIConfig(BaseModel):
    """Configuration for a specific AI task"""
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    provider: ProviderType
    model: str = Field(..., min_length=1, max_length=200)
    temperature: float = Field(..., ge=0, le=2)
    provider_preference: Optional[ProviderPreference] = None
    # Max output tokens for the response (maps to backend `max_tokens`).
    # Leave unset to use provider defaults.
    max_output_tokens: Optional[int] = Field(default=None, ge=1, le=1000000)
    # Context window upper bound used for local prompt budgeting (e.g. agent memory preflight).
    context_window_tokens: Optional[int] = Field(default=None, ge=1024, le=1000000)
    advanced: AdvancedTaskSettings

class ProviderPreferenceOverride(BaseModel):
    """Partial OpenRouter provider filtering override."""
    model_config = ConfigDict(extra="forbid")

    only: Optional[List[str]] = None
    ignore: Optional[List[str]] = None


class ThinkingConfigOverride(BaseModel):
    """Partial thinking configuration override."""
    model_config = ConfigDict(extra="forbid")

    effort: Optional[Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]] = None
    max_tokens: Optional[int] = Field(default=None, ge=1)
    gemini_thinking_level: Optional[str] = None
    gemini_budget_tokens: Optional[int] = Field(default=None, ge=0)


class AdvancedTaskSettingsOverride(BaseModel):
    """Partial advanced task settings override."""
    model_config = ConfigDict(extra="forbid")

    thinking_mode: Optional[Literal["off", "model", "custom"]] = None
    thinking_config: Optional[ThinkingConfigOverride] = None
    custom_thinking_template_id: Optional[str] = None
    tokenizer_override: Optional[Literal["openai", "claude", "gemini"]] = None
    request_format: Optional[Literal["openai_sdk", "claude_sdk", "openai_responses"]] = None
    verbosity: Optional[Literal["low", "medium", "high"]] = None


class TaskAIConfigOverride(BaseModel):
    """Partial AI task configuration override."""
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    provider: Optional[ProviderType] = None
    model: Optional[str] = Field(default=None, min_length=1, max_length=200)
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    provider_preference: Optional[ProviderPreferenceOverride] = None
    max_output_tokens: Optional[int] = Field(default=None, ge=1, le=1000000)
    context_window_tokens: Optional[int] = Field(default=None, ge=1024, le=1000000)
    advanced: Optional[AdvancedTaskSettingsOverride] = None


class TaskConfigSettings(BaseModel):
    """General task config plus per-task overrides."""
    model_config = ConfigDict(extra="forbid")

    general: TaskAIConfig
    overrides: Dict[str, TaskAIConfigOverride] = Field(default_factory=dict)

    @field_validator("overrides")
    @classmethod
    def validate_override_keys(cls, value: Dict[str, TaskAIConfigOverride]) -> Dict[str, TaskAIConfigOverride]:
        allowed = {member.value for member in AITaskType}
        unknown = [key for key in value.keys() if key not in allowed]
        if unknown:
            raise ValueError(f"Unknown task override keys: {', '.join(sorted(unknown))}")
        return value


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
    subAgent: bool = False


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
    quality: Literal["auto", "low", "medium", "high"] = "auto"
    background: Literal["auto", "opaque", "transparent"] = "auto"
    output_format: Literal["png", "jpeg", "webp"] = "png"
    output_compression: int = Field(default=90, ge=0, le=100)
    input_fidelity: Literal["low", "high"] = "high"


class NovelAIImageSettings(BaseModel):
    """NovelAI-specific image settings"""
    sampler: str = "k_euler_ancestral"
    steps: int = 28
    scale: float = 6.0
    noise_schedule: str = "karras"


class ImageGenConfig(BaseModel):
    """Image generation configuration"""
    provider: str = "openai"
    model: str = "gpt-image-1.5"
    aspect_ratio: str = "1:1"
    image_size: str = "1K"
    naturalStyles: List[NaturalImageStyle] = []
    tagBasedStyles: List[TagBasedImageStyle] = []
    selectedNaturalStyleId: Optional[str] = None
    selectedTagBasedStyleId: Optional[str] = None
    openaiSettings: OpenAIImageSettings = Field(default_factory=OpenAIImageSettings)
    novelaiSettings: NovelAIImageSettings = Field(default_factory=NovelAIImageSettings)


class UserSettingsResponse(BaseModel):
    """User settings response"""
    taskConfigSettings: TaskConfigSettings
    mainLanguage: str
    subLanguages: List[str] = []
    defaultSubLanguage: Optional[str] = None
    theme: str = "system"
    retryConfig: RetryConfig = Field(default_factory=RetryConfig)
    imageGenConfig: ImageGenConfig = Field(default_factory=ImageGenConfig)
    customThinkingTemplates: List[CustomThinkingTemplate] = []
    nativeOutputMode: bool = False
    vectorStorageEnabled: bool = False
    embeddingConfigs: EmbeddingConfigs = Field(default_factory=EmbeddingConfigs)
    ragSearchTopKPerQuery: int = Field(default=20, ge=1, le=200)
    ragSearchNeighborWindow: int = Field(default=0, ge=0, le=20)
    ragSearchMaxPrimaryChunks: int = Field(default=20, ge=1, le=200)
    ragSearchMaxTotalChunks: int = Field(default=60, ge=1, le=500)
    ragSearchKeywordPageSize: int = Field(default=20, ge=1, le=200)
    agentMemoryTopKPerQuery: int = Field(default=20, ge=1, le=200)
    agentMemoryNeighborWindow: int = Field(default=0, ge=0, le=20)
    agentMemoryMaxPrimaryMessages: int = Field(default=20, ge=1, le=200)
    agentMemoryMaxTotalMessages: int = Field(default=60, ge=1, le=500)
    patchAutoRetry: bool = True
    llmLoggingEnabled: bool = False
    toolCallHistoryLimit: int = 5
    thinkingHistoryLimit: int = 5
    toolCallAutoApprove: ToolCallAutoApprove = Field(default_factory=ToolCallAutoApprove)
    uiLanguage: str = "en"
    demoModeEnabled: bool = False

    class Config:
        from_attributes = True


class UserSettingsUpdate(BaseModel):
    """Update user settings"""
    taskConfigSettings: Optional[TaskConfigSettings] = None
    mainLanguage: Optional[str] = None
    subLanguages: Optional[List[str]] = None
    defaultSubLanguage: Optional[str] = None
    theme: Optional[str] = None
    retryConfig: Optional[RetryConfig] = None
    imageGenConfig: Optional[ImageGenConfig] = None
    customThinkingTemplates: Optional[List[CustomThinkingTemplate]] = None
    nativeOutputMode: Optional[bool] = None
    vectorStorageEnabled: Optional[bool] = None
    embeddingConfigs: Optional[EmbeddingConfigs] = None
    ragSearchTopKPerQuery: Optional[int] = Field(default=None, ge=1, le=200)
    ragSearchNeighborWindow: Optional[int] = Field(default=None, ge=0, le=20)
    ragSearchMaxPrimaryChunks: Optional[int] = Field(default=None, ge=1, le=200)
    ragSearchMaxTotalChunks: Optional[int] = Field(default=None, ge=1, le=500)
    ragSearchKeywordPageSize: Optional[int] = Field(default=None, ge=1, le=200)
    agentMemoryTopKPerQuery: Optional[int] = Field(default=None, ge=1, le=200)
    agentMemoryNeighborWindow: Optional[int] = Field(default=None, ge=0, le=20)
    agentMemoryMaxPrimaryMessages: Optional[int] = Field(default=None, ge=1, le=200)
    agentMemoryMaxTotalMessages: Optional[int] = Field(default=None, ge=1, le=500)
    patchAutoRetry: Optional[bool] = None
    llmLoggingEnabled: Optional[bool] = None
    toolCallHistoryLimit: Optional[int] = None
    thinkingHistoryLimit: Optional[int] = None
    toolCallAutoApprove: Optional[ToolCallAutoApprove] = None
    uiLanguage: Optional[str] = None
    demoModeEnabled: Optional[bool] = None

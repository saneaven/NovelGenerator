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


class AIFunctionType(str, Enum):
    """AI function types"""
    CHAT = "chat"
    TRANSLATION = "translation"
    STORY_EDIT = "storyEdit"
    CHAPTER_GEN = "chapterGen"


class ProviderPreference(BaseModel):
    """OpenRouter provider filtering"""
    only: Optional[List[str]] = None
    ignore: Optional[List[str]] = None


class ThinkingConfig(BaseModel):
    """Thinking configuration for model-native thinking"""
    effort: Optional[str] = "medium"  # legacy OpenRouter-style effort
    maxTokens: Optional[int] = None
    claudeBudgetTokens: Optional[int] = None
    geminiThinkingLevel: Optional[str] = None  # 'low' | 'high'
    geminiBudgetTokens: Optional[int] = None


class AdvancedFunctionSettings(BaseModel):
    """Advanced settings for AI functions"""
    enablePrefill: bool = False
    thinkingMode: str = "off"  # 'off' | 'model' | 'custom'
    thinkingConfig: Optional[ThinkingConfig] = Field(default_factory=lambda: ThinkingConfig())


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


class ProviderCredentials(BaseModel):
    """All provider credentials"""
    openai: OpenAICredentials = Field(default_factory=OpenAICredentials)
    gemini: GeminiCredentials = Field(default_factory=GeminiCredentials)
    claude: ClaudeCredentials = Field(default_factory=ClaudeCredentials)
    openrouter: OpenRouterCredentials = Field(default_factory=OpenRouterCredentials)
    custom: CustomCredentials = Field(default_factory=CustomCredentials)


class ThemeMode(str, Enum):
    """Theme mode options"""
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class UserSettingsResponse(BaseModel):
    """User settings response"""
    functionConfigs: Dict[str, FunctionAIConfig]
    providerCredentials: ProviderCredentials
    mainLanguage: str
    subLanguages: List[str] = []
    defaultSubLanguage: Optional[str] = None
    theme: str = "system"

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

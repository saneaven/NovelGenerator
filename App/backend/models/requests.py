from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Literal

class ProviderConfig(BaseModel):
    """Provider-specific configuration sent from frontend"""
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    additional_headers: Optional[Dict[str, str]] = None

class ProviderPreference(BaseModel):
    """Provider preference for OpenRouter (only/ignore lists)"""
    only: Optional[List[str]] = None
    ignore: Optional[List[str]] = None

class ReasoningConfig(BaseModel):
    """Reasoning configuration for OpenRouter (model-native reasoning)"""
    effort: Optional[Literal["low", "medium", "high"]] = None
    max_tokens: Optional[int] = None

class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

class ChatCompletionRequest(BaseModel):
    messages: List[Message]
    model: str = "gpt-4"
    temperature: float = Field(default=0.7, ge=0, le=2)
    functions: Optional[List[Dict]] = None
    max_tokens: Optional[int] = None
    config: ProviderConfig = Field(default_factory=ProviderConfig)
    provider_preference: Optional[ProviderPreference] = None
    reasoning_config: Optional[ReasoningConfig] = None
    thinking_mode: Optional[Literal["off", "custom", "model"]] = "off"

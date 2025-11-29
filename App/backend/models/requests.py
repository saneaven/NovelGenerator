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

class ThinkingConfig(BaseModel):
    """
    Provider-agnostic thinking configuration.

    Fields are optional; providers pick what they understand.
    """
    # Common - effort now includes 'none' for GPT-5
    effort: Optional[Literal["none", "low", "medium", "high"]] = "medium"
    max_tokens: Optional[int] = Field(default=None, alias="maxTokens")

    # GPT-5 specific - output verbosity
    verbosity: Optional[Literal["low", "medium", "high"]] = None

    # Claude (Anthropic)
    claude_budget_tokens: Optional[int] = Field(default=None, alias="claudeBudgetTokens")

    # Gemini
    gemini_thinking_level: Optional[Literal["low", "high"]] = Field(default=None, alias="geminiThinkingLevel")
    gemini_budget_tokens: Optional[int] = Field(default=None, alias="geminiBudgetTokens")

class ContentPart(BaseModel):
    """A part of message content (content or thinking)"""
    type: Literal["content", "thinking"]
    text: str

class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    contentParts: List[ContentPart]

    def get_content_text(self) -> str:
        """Extract text content from contentParts for LLM providers"""
        return "".join(part.text for part in self.contentParts if part.type == "content")

class ChatCompletionRequest(BaseModel):
    messages: List[Message]
    model: str = "gpt-4"
    temperature: float = Field(default=0.7, ge=0, le=2)
    functions: Optional[List[Dict]] = None
    max_tokens: Optional[int] = None
    config: ProviderConfig = Field(default_factory=ProviderConfig)
    provider_preference: Optional[ProviderPreference] = None
    thinking_mode: Optional[Literal["off", "custom", "model"]] = "off"
    thinking_config: Optional[ThinkingConfig] = None

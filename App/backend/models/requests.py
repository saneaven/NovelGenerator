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
    # Common - effort now includes 'none', 'minimal', 'xhigh' for GPT-5.2+
    effort: Optional[Literal["none", "minimal", "low", "medium", "high", "xhigh"]] = "medium"
    max_tokens: Optional[int] = Field(default=None, alias="maxTokens")

    # GPT-5 specific - output verbosity
    verbosity: Optional[Literal["low", "medium", "high"]] = None

    # Claude (Anthropic)
    claude_budget_tokens: Optional[int] = Field(default=None, alias="claudeBudgetTokens")

    # Gemini - now supports 'minimal' and 'medium' for Gemini 3 Flash
    gemini_thinking_level: Optional[Literal["minimal", "low", "medium", "high"]] = Field(default=None, alias="geminiThinkingLevel")
    gemini_budget_tokens: Optional[int] = Field(default=None, alias="geminiBudgetTokens")


class RetryConfig(BaseModel):
    """Retry configuration for error handling"""
    enabled: bool = True
    max_retries: int = Field(default=3, ge=0, le=10, alias="max_retries")
    retryable_status_codes: List[int] = Field(default=[429, 500, 502, 503, 504], alias="retryable_status_codes")
    retry_delay_ms: int = Field(default=1000, ge=100, le=30000, alias="retry_delay_ms")

class ContentPart(BaseModel):
    """A part of message content (content or thinking)"""
    type: Literal["content", "thinking"]
    text: str

class ToolCallFunction(BaseModel):
    """Function details in a tool call"""
    name: str
    arguments: str

class ToolCall(BaseModel):
    """A tool call from an assistant message"""
    id: str
    type: Literal["function"] = "function"
    function: ToolCallFunction

class ToolResult(BaseModel):
    """Result of a tool call execution"""
    tool_call_id: str
    tool_name: str  # Required for Gemini provider
    content: str

class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool_results"]
    contentParts: List[ContentPart] = []
    tool_calls: Optional[List[ToolCall]] = None
    tool_results: Optional[List[ToolResult]] = None

    def get_content_text(self) -> str:
        """Extract text content from contentParts for LLM providers"""
        return "".join(part.text for part in self.contentParts if part.type == "content")

class ChatCompletionRequest(BaseModel):
    messages: List[Message]
    model: str
    temperature: float = Field(default=0.7, ge=0, le=2)
    tools: Optional[List[Dict]] = None
    tool_choice: Optional[Literal["auto", "required", "none"]] = None
    max_tokens: Optional[int] = None
    config: ProviderConfig = Field(default_factory=ProviderConfig)
    provider_preference: Optional[ProviderPreference] = None
    thinking_mode: Optional[Literal["off", "custom", "model"]] = "off"
    thinking_config: Optional[ThinkingConfig] = None
    custom_api_format: Optional[Literal["openai", "claude", "gemini"]] = None  # For custom provider
    retry_config: Optional[RetryConfig] = None
    native_tool_call: bool = False

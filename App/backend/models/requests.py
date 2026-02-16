from pydantic import BaseModel, Field
from typing import Any, List, Optional, Dict, Literal

class ProviderPreference(BaseModel):
    """Provider preference for OpenRouter (only/ignore lists)"""
    only: Optional[List[str]] = None
    ignore: Optional[List[str]] = None

class ThinkingConfig(BaseModel):
    """
    Provider-agnostic thinking configuration.

    Fields are optional; providers pick what they understand.
    """
    # Common effort values across providers.
    # Claude adaptive thinking uses: low | medium | high | max
    effort: Optional[Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]] = None
    max_tokens: Optional[int] = None

    # GPT-5 specific - output verbosity
    verbosity: Optional[Literal["low", "medium", "high"]] = None

    # Gemini - now supports 'minimal' and 'medium' for Gemini 3 Flash
    gemini_thinking_level: Optional[Literal["minimal", "low", "medium", "high"]] = None
    gemini_budget_tokens: Optional[int] = None


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
    extra_content: Optional[Dict[str, Any]] = None

class ToolResult(BaseModel):
    """Result of a tool call execution"""
    tool_call_id: str
    tool_name: str  # Required for Gemini provider
    content: str

class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool_results"]
    content_parts: List[ContentPart] = Field(default_factory=list)
    tool_calls: Optional[List[ToolCall]] = None
    tool_results: Optional[List[ToolResult]] = None

class ChatCompletionRequest(BaseModel):
    messages: List[Message]
    model: str
    temperature: float = Field(default=0.7, ge=0, le=2)
    tools: Optional[List[Dict]] = None
    tool_choice: Optional[Literal["auto", "required", "none"]] = None
    max_tokens: Optional[int] = None
    provider_preference: Optional[ProviderPreference] = None
    thinking_mode: Optional[Literal["off", "custom", "model"]] = "off"
    thinking_config: Optional[ThinkingConfig] = None
    thinking_format: Optional[Literal["openai", "claude", "gemini"]] = None  # For custom provider(openai_sdk only)
    request_format: Optional[Literal["openai_sdk", "claude_sdk"]] = "openai_sdk"
    retry_config: Optional[RetryConfig] = None
    native_tool_call: bool = False


class ProviderModelsRequest(BaseModel):
    request_format: Optional[Literal["openai_sdk", "claude_sdk"]] = "openai_sdk"

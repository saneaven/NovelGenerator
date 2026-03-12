from pydantic import BaseModel, Field, ConfigDict
from typing import Any, List, Optional, Dict, Literal

CustomKind = Literal["openai_completion", "openai_response", "claude"]

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
    """A part of message content"""
    type: Literal["content", "image", "file"]
    text: Optional[str] = None
    mime_type: Optional[str] = None
    filename: Optional[str] = None
    storage_key: Optional[str] = None

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
    model_config = ConfigDict(extra="forbid")

    messages: List[Message]
    model: str
    temperature: float = Field(default=0.7, ge=0, le=2)
    tools: Optional[List[Dict]] = None
    tool_choice: Optional[Literal["auto", "required", "none"]] = None
    max_tokens: Optional[int] = None
    provider_preference: Optional[ProviderPreference] = None
    thinking_mode: Optional[Literal["off", "custom", "model"]] = "off"
    thinking_config: Optional[ThinkingConfig] = None
    custom_kind: Optional[CustomKind] = "openai_completion"
    retry_config: Optional[RetryConfig] = None
    native_tool_call: bool = False
    verbosity: Optional[Literal["low", "medium", "high"]] = None  # GPT-5 output verbosity


class ProviderModelsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    custom_kind: Optional[CustomKind] = "openai_completion"

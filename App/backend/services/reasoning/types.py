from __future__ import annotations

from typing import Any, Literal, TypedDict


ReasoningType = Literal["custom", "openai", "gemini", "claude", "openrouter", "openai_compatible"]
ReasoningProvider = Literal["openai", "gemini", "claude", "openrouter", "custom", "xai"]


class ReasoningMeta(TypedDict, total=False):
    provider: ReasoningProvider
    openai_compatible_thinking_format: Literal["openai", "claude", "gemini"]
    openrouter_reasoning_format: str


class ReasoningDetail(TypedDict):
    type: ReasoningType
    meta: ReasoningMeta
    data: dict[str, Any]
    token_count: int


class ContentPart(TypedDict):
    type: Literal["content", "thinking"]
    text: str


class ToolFunction(TypedDict):
    name: str
    arguments: str


class ToolCall(TypedDict, total=False):
    id: str
    type: Literal["function"]
    function: ToolFunction
    extra_content: dict[str, Any]


class Message(TypedDict, total=False):
    role: Literal["system", "user", "assistant", "tool_results"]
    content_parts: list[ContentPart]
    tool_calls: list[ToolCall]
    tool_results: list[dict[str, Any]]
    reasoning_detail: ReasoningDetail
    run_id: str
    seq_in_thread: int

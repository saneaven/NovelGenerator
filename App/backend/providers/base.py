import copy
from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict, List, Optional

from .contracts import ProviderEvent

class BaseProvider(ABC):
    """Base class for all LLM providers"""

    def __init__(self, config: Dict):
        self.config = config

    @staticmethod
    def _extract_text_content(message: Dict) -> str:
        """Extract canonical text content from content_parts."""
        parts = message.get("content_parts")
        if not isinstance(parts, list):
            return ""

        chunks: List[str] = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            if part.get("type") != "content":
                continue
            text = part.get("text")
            if isinstance(text, str) and text:
                chunks.append(text)
        return "".join(chunks)

    @staticmethod
    def _copy_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return copy.deepcopy(messages)

    @staticmethod
    def _snapshot_reasoning_details(final_snapshot: Any) -> list[dict[str, Any]]:
        raw = getattr(final_snapshot, "reasoning_details", None)
        if not isinstance(raw, list):
            return []
        return [item for item in raw if isinstance(item, dict)]

    @staticmethod
    def _snapshot_reasoning_tokens(final_snapshot: Any) -> int | None:
        value = getattr(final_snapshot, "reasoning_tokens", None)
        if isinstance(value, bool):
            value = int(value)
        if isinstance(value, int):
            return max(0, value)
        return None

    @staticmethod
    def _reasoning_text_from_parts(content_parts: Any) -> str:
        if not isinstance(content_parts, list):
            return ""
        chunks: list[str] = []
        for part in content_parts:
            if not isinstance(part, dict):
                continue
            if part.get("type") != "thinking":
                continue
            text = part.get("text")
            if isinstance(text, str) and text:
                chunks.append(text)
        return "".join(chunks)

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        return None

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        return self._snapshot_reasoning_tokens(final_snapshot)

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return None

    @abstractmethod
    def stream_chat(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        tools: Optional[List[Dict]] = None,
        tool_choice: Optional[str] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None,
        thinking_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None,
        custom_kind: Optional[str] = None,
        native_tool_call: bool = False,
        verbosity: Optional[str] = None,
    ) -> AsyncGenerator[ProviderEvent, None]:
        """
        Stream chat completions from the provider

        Args:
            messages: List of canonical message dicts with 'role' and 'content_parts'
            model: Model identifier
            temperature: Temperature for generation
            tools: Optional tool calling schemas
            tool_choice: Tool choice mode ('auto', 'required', 'none')
            max_tokens: Maximum tokens to generate
            provider_preference: Provider-specific preferences (e.g., OpenRouter only/ignore)
            thinking_config: Thinking configuration for model-native thinking (mapped to provider-native thinking field)
            thinking_mode: Thinking mode ('off', 'custom', 'model')
            custom_kind: Custom endpoint kind ('openai_completion', 'openai_response', 'claude')
            native_tool_call: If true, provider should parse <tool_call> tags from text and emit tool_calls deltas.
            verbosity: GPT-5 output verbosity ('low', 'medium', 'high'). Maps to text.verbosity in Responses API.

        Yields:
            ProviderEvent objects. SSE formatting is handled by the API endpoint.
        """
        pass

    @abstractmethod
    async def get_models(self) -> Dict:
        """
        Get available models from the provider

        Returns:
            Dict with model information
        """
        pass

    @abstractmethod
    def validate_config(self) -> bool:
        """
        Validate provider configuration

        Returns:
            True if configuration is valid
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identifier"""
        pass

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable provider name"""
        pass


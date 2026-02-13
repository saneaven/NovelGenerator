from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Dict, Optional

from .contracts import ProviderEvent

class BaseProvider(ABC):
    """Base class for all LLM providers"""

    def __init__(self, config: Dict):
        self.config = config

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
        thinking_format: Optional[str] = None,
        request_format: Optional[str] = None,
        retry_config: Optional[Dict] = None,
        native_tool_call: bool = False,
    ) -> AsyncGenerator[ProviderEvent, None]:
        """
        Stream chat completions from the provider

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model identifier
            temperature: Temperature for generation
            tools: Optional tool calling schemas
            tool_choice: Tool choice mode ('auto', 'required', 'none')
            max_tokens: Maximum tokens to generate
            provider_preference: Provider-specific preferences (e.g., OpenRouter only/ignore)
            thinking_config: Thinking configuration for model-native thinking (mapped to provider-native thinking field)
            thinking_mode: Thinking mode ('off', 'custom', 'model')
            thinking_format: Custom endpoint thinking dialect ('openai', 'claude', 'gemini')
            request_format: Custom endpoint request format ('openai_sdk', 'claude_sdk')
            retry_config: Retry configuration for error handling
            native_tool_call: If true, provider should parse <tool_calls> tags from text and emit tool_calls deltas.

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


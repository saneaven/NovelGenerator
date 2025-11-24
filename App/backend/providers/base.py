from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Dict, Optional

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
        functions: Optional[List[Dict]] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None,
        thinking_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None
    ) -> AsyncGenerator[bytes, None]:
        """
        Stream chat completions from the provider

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model identifier
            temperature: Temperature for generation
            functions: Optional function calling schemas
            max_tokens: Maximum tokens to generate
            provider_preference: Provider-specific preferences (e.g., OpenRouter only/ignore)
            thinking_config: Thinking configuration for model-native thinking (mapped to provider-native thinking field)
            thinking_mode: Thinking mode ('off', 'custom', 'model')

        Yields:
            SSE-formatted bytes
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

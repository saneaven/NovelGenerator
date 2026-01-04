"""Custom endpoint provider with native SDK delegation.

This provider delegates to native SDK providers (OpenAI, Claude, Gemini) based on
the selected custom_api_format, allowing users to use custom endpoints with the
proper SDK for each API format.
"""

from typing import AsyncGenerator, Dict, List, Optional

from .base import BaseProvider
from .registry import ProviderRegistry


# Import providers lazily to avoid circular imports
def _create_openai_delegate(config: Dict) -> BaseProvider:
    """Create an OpenAI SDK delegate with custom base_url."""
    from .async_openai_provider import AsyncOpenAIProvider

    class _OpenAIDelegate(AsyncOpenAIProvider):
        """OpenAI SDK delegate with custom base_url."""

        def __init__(self, cfg: Dict):
            self._custom_base_url = (cfg.get("base_url") or "").strip()
            self._custom_headers = cfg.get("additional_headers") or {}
            super().__init__(cfg)

        @property
        def name(self) -> str:
            return "custom_openai"

        @property
        def display_name(self) -> str:
            return "Custom OpenAI"

        @property
        def base_url(self) -> str:
            return self._custom_base_url.rstrip("/")

        @property
        def default_headers(self) -> Dict[str, str]:
            return self._custom_headers

        def validate_config(self) -> bool:
            # For custom endpoints, we only require base_url (api_key may be optional)
            return bool(self._custom_base_url)

    return _OpenAIDelegate(config)


def _create_claude_delegate(config: Dict) -> BaseProvider:
    """Create a Claude SDK delegate with custom base_url."""
    from .claude_provider import ClaudeProvider

    class _ClaudeDelegate(ClaudeProvider):
        """Claude SDK delegate with custom base_url."""

        def __init__(self, cfg: Dict):
            # Store custom config before parent init
            self._custom_base_url = (cfg.get("base_url") or "").strip()
            # Ensure base_url is in config for parent's _build_client
            cfg_with_base = {**cfg, "base_url": self._custom_base_url}
            super().__init__(cfg_with_base)

        @property
        def name(self) -> str:
            return "custom_claude"

        @property
        def display_name(self) -> str:
            return "Custom Claude"

        def validate_config(self) -> bool:
            # For custom Claude endpoints, require base_url
            # API key may be optional for some self-hosted endpoints
            return bool(self._custom_base_url)

    return _ClaudeDelegate(config)  # type: ignore[abstract]


def _create_gemini_delegate(config: Dict) -> BaseProvider:
    """Create a Gemini SDK delegate with custom base_url."""
    from .gemini_provider import GeminiProvider

    class _GeminiDelegate(GeminiProvider):
        """Gemini SDK delegate with custom base_url."""

        def __init__(self, cfg: Dict):
            self._custom_base_url = (cfg.get("base_url") or "").strip()
            # Ensure base_url is in config for parent's _build_client
            cfg_with_base = {**cfg, "base_url": self._custom_base_url}
            super().__init__(cfg_with_base)

        @property
        def name(self) -> str:
            return "custom_gemini"

        @property
        def display_name(self) -> str:
            return "Custom Gemini"

        def validate_config(self) -> bool:
            # For custom Gemini endpoints, require base_url
            # API key may be optional for some self-hosted endpoints
            return bool(self._custom_base_url)

    return _GeminiDelegate(config)  # type: ignore[abstract]


@ProviderRegistry.register
class CustomProvider(BaseProvider):
    """Custom endpoint provider that delegates to native SDK providers.

    Based on the selected custom_api_format, this provider routes requests to
    the appropriate native SDK:
    - 'openai' or 'openrouter' -> OpenAI SDK with custom base_url
    - 'claude' -> Anthropic SDK with custom base_url
    - 'gemini' -> Google GenAI SDK with custom base_url
    """

    def __init__(self, config: Dict):
        super().__init__(config)
        self._base_url = (config.get("base_url") or "").strip()
        self._api_key = config.get("api_key")
        self._additional_headers = config.get("additional_headers") or {}
        # Lazy-initialized delegate providers
        self._delegates: Dict[str, BaseProvider] = {}

    @property
    def name(self) -> str:
        return "custom"

    @property
    def display_name(self) -> str:
        return "Custom Endpoint"

    def validate_config(self) -> bool:
        return bool(self._base_url)

    def _get_delegate_config(self) -> Dict:
        """Build config dict for delegate providers."""
        return {
            "api_key": self._api_key,
            "base_url": self._base_url,
            "additional_headers": self._additional_headers,
        }

    def _get_delegate(self, api_format: str) -> BaseProvider:
        """Get or create a delegate provider for the specified format.

        Args:
            api_format: The API format ('openai', 'claude', 'gemini', 'openrouter')

        Returns:
            A delegate provider instance configured with custom base_url
        """
        if api_format not in self._delegates:
            config = self._get_delegate_config()

            if api_format in ("openai", "openrouter"):
                self._delegates[api_format] = _create_openai_delegate(config)
            elif api_format == "claude":
                self._delegates[api_format] = _create_claude_delegate(config)
            elif api_format == "gemini":
                self._delegates[api_format] = _create_gemini_delegate(config)
            else:
                # Default to OpenAI format for unknown formats
                self._delegates[api_format] = _create_openai_delegate(config)

        return self._delegates[api_format]

    async def stream_chat(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        functions: Optional[List[Dict]] = None,
        tool_choice: Optional[str] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None,
        thinking_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None,
        custom_api_format: Optional[str] = None,
        retry_config: Optional[Dict] = None,
    ) -> AsyncGenerator[bytes, None]:
        """Stream chat completions by delegating to the appropriate native SDK provider.

        Args:
            messages: List of message dicts
            model: Model identifier
            temperature: Temperature for generation
            functions: Optional function calling schemas
            tool_choice: Tool choice mode
            max_tokens: Maximum tokens to generate
            provider_preference: Provider-specific preferences
            thinking_config: Thinking configuration
            thinking_mode: Thinking mode ('off', 'custom', 'model')
            custom_api_format: API format ('openai', 'claude', 'gemini', 'openrouter')
            retry_config: Retry configuration

        Yields:
            SSE-formatted bytes from the delegate provider
        """
        api_format = custom_api_format or "openai"
        delegate = self._get_delegate(api_format)

        # Delegate to the native provider's stream_chat
        async for chunk in delegate.stream_chat(
            messages=messages,
            model=model,
            temperature=temperature,
            functions=functions,
            tool_choice=tool_choice,
            max_tokens=max_tokens,
            provider_preference=provider_preference,
            thinking_config=thinking_config,
            thinking_mode=thinking_mode,
            custom_api_format=custom_api_format,
            retry_config=retry_config,
        ):
            yield chunk

    async def get_models(self) -> Dict:
        """Get available models from the custom endpoint.

        Uses the OpenAI delegate by default since most custom endpoints
        use OpenAI-compatible model listing.

        Returns:
            Dict with model information
        """
        delegate = self._get_delegate("openai")
        return await delegate.get_models()

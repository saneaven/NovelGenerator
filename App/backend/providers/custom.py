from typing import Dict

from .async_openai_provider import AsyncOpenAIProvider
from .registry import ProviderRegistry


@ProviderRegistry.register
class CustomOpenAIProvider(AsyncOpenAIProvider):
    """Generic OpenAI-compatible endpoint provider."""

    def __init__(self, config: Dict):
        self._base_url = (config.get("base_url") or "").strip()
        self._additional_headers = config.get("additional_headers") or {}
        super().__init__(config)

    @property
    def name(self) -> str:
        return "custom"

    @property
    def display_name(self) -> str:
        return "Custom OpenAI-Compatible"

    def validate_config(self) -> bool:
        return bool(self._base_url)

    @property
    def base_url(self) -> str:
        return self._base_url.rstrip("/")

    @property
    def default_headers(self) -> Dict[str, str]:
        return self._additional_headers

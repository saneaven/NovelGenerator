import os
from typing import Dict, Optional

from .async_openai_provider import AsyncOpenAIProvider
from .registry import ProviderRegistry


@ProviderRegistry.register
class CopilotProvider(AsyncOpenAIProvider):
    """GitHub Copilot provider using OpenAI-compatible streaming."""

    max_retries = 10

    @property
    def name(self) -> str:
        return "copilot"

    @property
    def display_name(self) -> str:
        return "GitHub Copilot"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    @property
    def api_key(self) -> Optional[str]:
        return os.getenv("COPILOT_TOKEN")

    @property
    def base_url(self) -> str:
        return "https://api.githubcopilot.com"

    @property
    def default_headers(self) -> Dict[str, str]:
        return {}

    def _should_retry(self, status: Optional[int], attempt: int) -> bool:
        if status in {400, 403} and attempt < self.max_retries - 1:
            return True
        return super()._should_retry(status, attempt)

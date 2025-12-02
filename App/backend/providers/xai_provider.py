from .async_openai_provider import AsyncOpenAIProvider
from .registry import ProviderRegistry


@ProviderRegistry.register
class XAIProvider(AsyncOpenAIProvider):
    """xAI Grok provider - OpenAI compatible API."""

    @property
    def name(self) -> str:
        return "xai"

    @property
    def display_name(self) -> str:
        return "xAI (Grok)"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    @property
    def base_url(self) -> str:
        return "https://api.x.ai/v1"
    # get_models() inherited from AsyncOpenAIProvider - xAI supports /v1/models endpoint

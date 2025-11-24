from typing import Dict, List, Optional, Tuple

from .async_openai_provider import AsyncOpenAIProvider
from .registry import ProviderRegistry


@ProviderRegistry.register
class OpenRouterProvider(AsyncOpenAIProvider):
    """OpenRouter API provider using the OpenAI SDK."""

    models_endpoint = "/models/user"

    def __init__(self, config: Dict):
        self._additional_headers = config.get("additional_headers") or {}
        super().__init__(config)

    @property
    def name(self) -> str:
        return "openrouter"

    @property
    def display_name(self) -> str:
        return "OpenRouter"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    @property
    def base_url(self) -> str:
        return "https://openrouter.ai/api/v1"

    @property
    def default_headers(self) -> Dict[str, str]:
        headers = {
            "HTTP-Referer": "https://novelgenerator.local",
            "X-Title": "Novel Generator",
        }
        headers.update(self._additional_headers)
        return headers

    def _build_extra_body(
        self,
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
    ) -> Optional[Dict]:
        extra: Dict[str, Dict] = {}

        if provider_preference:
            provider_payload: Dict[str, List[str]] = {}
            only = provider_preference.get("only")
            ignore = provider_preference.get("ignore")
            if only:
                provider_payload["only"] = only
            if ignore:
                provider_payload["ignore"] = ignore
            if provider_payload:
                extra["provider"] = provider_payload

        if thinking_config:
            # OpenRouter expects the field name 'reasoning', map from our thinking config
            extra["reasoning"] = thinking_config

        return extra or None

    def _mutate_chunk(
        self,
        chunk: Dict,
        thinking_mode: Optional[str],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        if thinking_mode != "model":
            return chunk, []

        choices = chunk.get("choices") or []
        if not choices:
            return chunk, []

        delta = choices[0].get("delta") or {}
        thinking_details = delta.get("thinking_details") or delta.get("reasoning_details")
        if not thinking_details:
            return chunk, []

        for detail in thinking_details:
            if isinstance(detail, dict) and detail.get("type") == "text" and detail.get("text"):
                thinking = delta.setdefault("thinking", {})
                thinking["text"] = detail["text"]
                break

        # Normalize key for downstream consumers
        if "reasoning_details" in delta and "thinking_details" not in delta:
            delta["thinking_details"] = delta.pop("reasoning_details")

        return chunk, []

import re
from typing import Dict, Optional

from .async_openai_provider import AsyncOpenAIProvider
from .registry import ProviderRegistry

# Text/chat model patterns: gpt-* or o{number}*
TEXT_MODEL_REGEX = re.compile(r'^(gpt-|o\d)')

# GPT-5 model pattern
GPT5_PATTERN = re.compile(r'gpt-?5', re.IGNORECASE)


@ProviderRegistry.register
class OpenAIProvider(AsyncOpenAIProvider):
    """Direct OpenAI API provider."""

    @property
    def name(self) -> str:
        return "openai"

    @property
    def display_name(self) -> str:
        return "OpenAI"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    @property
    def base_url(self) -> str:
        return "https://api.openai.com/v1"

    async def get_models(self) -> Dict:
        """Fetch available OpenAI models, filtered to text/chat models only."""
        result = await super().get_models()

        # Filter to text/chat models only (gpt-* or o{number}*)
        text_models = [
            model for model in result.get("data", [])
            if TEXT_MODEL_REGEX.match(model.get("id", ""))
        ]

        return {"data": text_models}

    def _is_gpt5_model(self, model: str) -> bool:
        """Check if model is GPT-5 family (gpt-5, gpt-5-mini, gpt-5.1, etc.)"""
        return bool(GPT5_PATTERN.search(model))

    def _build_extra_body(
        self,
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
        model: str = "",
    ) -> Optional[Dict]:
        """Build extra_body for GPT-5 models with reasoning and verbosity parameters."""
        if not self._is_gpt5_model(model):
            return None

        extra: Dict = {}

        # Map effort to reasoning.effort (GPT-5 API format)
        effort = "medium"
        if thinking_config:
            effort = thinking_config.get("effort", "medium") or "medium"
        extra["reasoning"] = {"effort": effort}

        # Map verbosity to text.verbosity if specified
        if thinking_config and thinking_config.get("verbosity"):
            extra["text"] = {"verbosity": thinking_config["verbosity"]}

        return extra

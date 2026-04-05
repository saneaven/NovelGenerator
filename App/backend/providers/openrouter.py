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
            "HTTP-Referer": "https://novelbuds.com",
            "X-Title": "Novel Buds",
        }
        headers.update(self._additional_headers)
        return headers

    @staticmethod
    def _read_openrouter_format(details: list[dict[str, object]]) -> str | None:
        for detail in details:
            fmt = detail.get("format") if isinstance(detail, dict) else None
            if isinstance(fmt, str) and fmt.strip():
                return fmt
        return None

    def read_reasoning_detail(self, final_snapshot, advanced: Dict) -> Dict | None:
        details = self._snapshot_reasoning_details(final_snapshot)
        reasoning_text = self._reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not reasoning_text:
            return None

        meta: Dict[str, object] = {"provider": "openrouter"}
        fmt = self._read_openrouter_format(details)
        if isinstance(fmt, str):
            meta["openrouter_reasoning_format"] = fmt

        data: Dict[str, object] = {"reasoning_details": details}
        if reasoning_text:
            data["reasoning"] = reasoning_text
            meta["thinking_display"] = "reasoning"

        return {
            "type": "openrouter",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: Dict) -> str | None:
        return "reasoning"

    def _build_extra_body(
        self,
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
        model: str = "",
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
            reasoning: Dict[str, object] = {}
            if thinking_config.get("effort") is not None:
                reasoning["effort"] = thinking_config["effort"]
            if thinking_config.get("max_tokens") is not None:
                reasoning["max_tokens"] = thinking_config["max_tokens"]
            if reasoning:
                extra["reasoning"] = reasoning

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
        reasoning_details = delta.get("reasoning_details") or delta.get("thinking_details")
        if not reasoning_details:
            return chunk, []

        for detail in reasoning_details:
            if isinstance(detail, dict):
                detail_type = detail.get("type")
                text = None

                # Format 1: reasoning.text type
                if detail_type == "reasoning.text":
                    text = detail.get("text")
                # Format 2: reasoning.summary type
                elif detail_type == "reasoning.summary":
                    text = detail.get("summary")
                # Format 3: content-based (no type field)
                elif detail.get("content"):
                    text = detail.get("content")

                if text:
                    thinking = delta.setdefault("thinking", {})
                    thinking["text"] = text
                    break

        return chunk, []

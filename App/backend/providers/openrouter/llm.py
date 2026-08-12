import copy
from typing import Any, Dict, List, Optional, Tuple

from ..shared.async_openai_provider import AsyncOpenAIProvider


_REASONING_DETAIL_TEXT_FIELD = {
    "reasoning.text": "text",
    "reasoning.summary": "summary",
}


def _merge_openrouter_reasoning_details(details: list[Any]) -> list[Any]:
    """Merge adjacent streamed OpenRouter reasoning blocks without mutating input."""
    merged: list[Any] = []

    for raw_detail in details:
        detail = copy.deepcopy(raw_detail)
        if not isinstance(detail, dict):
            merged.append(detail)
            continue

        detail_type = detail.get("type")
        text_field = (
            _REASONING_DETAIL_TEXT_FIELD.get(detail_type)
            if isinstance(detail_type, str)
            else None
        )
        text = detail.get(text_field) if text_field is not None else None
        if text_field is None or (text is not None and not isinstance(text, str)):
            merged.append(detail)
            continue

        previous = merged[-1] if merged else None
        previous_text = previous.get(text_field) if isinstance(previous, dict) else None
        if (
            isinstance(previous, dict)
            and previous.get("type") == detail_type
            and (previous_text is None or isinstance(previous_text, str))
        ):
            previous[text_field] = (previous_text or "") + (text or "")
            metadata_fields = (
                ("format", "signature")
                if detail_type == "reasoning.text"
                else ("format",)
            )
            for metadata_field in metadata_fields:
                if not previous.get(metadata_field) and detail.get(metadata_field):
                    previous[metadata_field] = copy.deepcopy(detail[metadata_field])
            continue

        merged.append(detail)

    return merged


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
        details = _merge_openrouter_reasoning_details(
            self._snapshot_reasoning_details(final_snapshot)
        )
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

    def _convert_assistant_reasoning_history(self, reasoning_detail: Dict[str, Any]) -> Dict[str, object]:
        copied_detail = copy.deepcopy(reasoning_detail)
        reasoning_data = copied_detail.get("data")
        if isinstance(reasoning_data, dict):
            for key in ("reasoning_details", "details"):
                raw_details = reasoning_data.get(key)
                if isinstance(raw_details, list):
                    reasoning_data[key] = _merge_openrouter_reasoning_details(raw_details)

        return super()._convert_assistant_reasoning_history(copied_detail)

    def get_stream_thinking_display_path(self, advanced: Dict) -> str | None:
        return "reasoning"

    @staticmethod
    def _compute_pricing_display(pricing: Any) -> dict[str, float] | None:
        if not isinstance(pricing, dict):
            return None
        out: dict[str, float] = {}
        for key in ("prompt", "completion", "image"):
            raw = pricing.get(key)
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue
            out[f"{key}_per_1m"] = round(value * 1_000_000.0, 6)
        return out or None

    @classmethod
    def annotate_endpoints_payload_for_ui(cls, payload: Any) -> Any:
        if not isinstance(payload, dict):
            return payload
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("endpoints"), list):
            return payload

        projected: list[dict[str, Any]] = []
        for item in data["endpoints"]:
            if not isinstance(item, dict):
                projected.append(item)
                continue
            endpoint = dict(item)
            pricing_display = cls._compute_pricing_display(endpoint.get("pricing"))
            if pricing_display is not None:
                endpoint["pricing_display"] = pricing_display
            projected.append(endpoint)

        result = dict(payload)
        result["data"] = dict(data)
        result["data"]["endpoints"] = projected
        return result

    async def get_models(self) -> Dict:
        payload = await super().get_models()
        data = payload.get("data")
        if not isinstance(data, list):
            return payload

        projected: list[dict[str, Any]] = []
        for item in data:
            if not isinstance(item, dict):
                projected.append(item)
                continue
            model = dict(item)
            pricing_display = self._compute_pricing_display(model.get("pricing"))
            if pricing_display is not None:
                model["pricing_display"] = pricing_display
            projected.append(model)

        result = dict(payload)
        result["data"] = projected
        return result

    def _build_extra_body(
        self,
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
        model: str = "",
        *,
        thinking_mode: Optional[str] = None,
        provider_settings: Optional[Dict[str, object]] = None,
    ) -> Optional[Dict]:
        del thinking_mode, provider_settings
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


def create_provider(*, provider_config: Dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return OpenRouterProvider(provider_config)

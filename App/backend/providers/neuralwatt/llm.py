from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from ..shared.async_openai_provider import AsyncOpenAIProvider


def _pricing_display(pricing: Any) -> dict[str, float] | None:
    if not isinstance(pricing, dict) or pricing.get("pricing_tbd") is True:
        return None

    result: dict[str, float] = {}
    for source_key, target_key in (
        ("input_per_million", "prompt_per_1m"),
        ("output_per_million", "completion_per_1m"),
    ):
        try:
            value = float(pricing.get(source_key))
        except (TypeError, ValueError):
            continue
        result[target_key] = round(value, 6)
    return result or None


def _project_model(item: dict[str, Any]) -> dict[str, Any]:
    projected = dict(item)
    metadata = item.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}

    for source_key, target_key in (
        ("display_name", "display_name"),
        ("description", "description"),
        ("provider", "category"),
    ):
        value = metadata.get(source_key)
        if value is not None:
            projected[target_key] = value

    limits = metadata.get("limits")
    if not isinstance(limits, dict):
        limits = {}

    context_length = limits.get("max_context_length")
    if context_length is None:
        context_length = item.get("max_model_len")
    if context_length is not None:
        projected["context_length"] = context_length

    max_output_tokens = limits.get("max_output_tokens")
    if max_output_tokens is not None:
        projected["max_output_tokens"] = max_output_tokens

    capabilities = metadata.get("capabilities")
    if isinstance(capabilities, dict):
        projected["capabilities"] = capabilities
        vision = capabilities.get("vision")
        if isinstance(vision, bool):
            projected["input_modalities"] = ["text", "image"] if vision else ["text"]

    pricing = metadata.get("pricing")
    if isinstance(pricing, dict):
        primary_pricing = {
            key: pricing[key]
            for key in ("input_per_million", "output_per_million")
            if key in pricing
        }
        if primary_pricing:
            projected["pricing"] = primary_pricing
        pricing_display = _pricing_display(pricing)
        if pricing_display is not None:
            projected["pricing_display"] = pricing_display

    return projected


class NeuralwattProvider(AsyncOpenAIProvider):
    """Neuralwatt provider using its OpenAI-compatible API."""

    @property
    def name(self) -> str:
        return "neuralwatt"

    @property
    def display_name(self) -> str:
        return "Neuralwatt"

    @property
    def base_url(self) -> str:
        return "https://api.neuralwatt.com/v1"

    def validate_config(self) -> bool:
        return bool(str(self.api_key or "").strip())

    async def get_models(self) -> Dict:
        payload = await super().get_models()
        data = payload.get("data")
        if not isinstance(data, list):
            return payload

        result = dict(payload)
        result["data"] = [
            _project_model(item) if isinstance(item, dict) else item
            for item in data
        ]
        return result

    def read_reasoning_detail(
        self,
        final_snapshot: Any,
        advanced: dict[str, Any],
    ) -> dict[str, Any] | None:
        del advanced
        details = self._snapshot_reasoning_details(final_snapshot)
        reasoning_text = self._reasoning_text_from_parts(
            getattr(final_snapshot, "content_parts", None)
        )
        if not details and not reasoning_text:
            return None

        data: dict[str, Any] = {"reasoning_details": details}
        meta: dict[str, Any] = {"provider": "neuralwatt"}
        if reasoning_text:
            data["reasoning"] = reasoning_text
            meta["thinking_display"] = "reasoning"

        return {
            "type": "neuralwatt",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        del advanced
        return "reasoning"

    def _build_extra_body(
        self,
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
        model: str = "",
        *,
        thinking_mode: Optional[str] = None,
        provider_settings: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict]:
        del provider_preference, model, provider_settings

        if thinking_mode in {"off", "custom"}:
            return {"chat_template_kwargs": {"enable_thinking": False}}

        if thinking_mode != "model" or not isinstance(thinking_config, dict):
            return None

        extra: dict[str, Any] = {}
        effort = thinking_config.get("effort")
        if effort is not None:
            extra["reasoning_effort"] = effort
        max_tokens = thinking_config.get("max_tokens")
        if max_tokens is not None:
            extra["thinking_token_budget"] = max_tokens
        return extra or None

    def _mutate_chunk(
        self,
        chunk: Dict,
        thinking_mode: Optional[str],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        if thinking_mode != "model":
            return chunk, []

        choices = chunk.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            return chunk, []

        delta = choices[0].get("delta")
        if not isinstance(delta, dict):
            return chunk, []

        reasoning_chunks: list[str] = []
        reasoning_content = delta.get("reasoning_content")
        if isinstance(reasoning_content, str):
            reasoning_chunks.append(reasoning_content)

        reasoning = delta.get("reasoning")
        if isinstance(reasoning, str):
            reasoning_chunks.append(reasoning)
        elif isinstance(reasoning, dict):
            reasoning_text = reasoning.get("text")
            if isinstance(reasoning_text, str):
                reasoning_chunks.append(reasoning_text)

        if reasoning_chunks:
            thinking = delta.setdefault("thinking", {})
            if isinstance(thinking, dict):
                thinking["text"] = "".join(reasoning_chunks)

        details = delta.get("reasoning_details")
        if not isinstance(details, list):
            choice_details = choices[0].get("reasoning_details")
            if isinstance(choice_details, list):
                delta["reasoning_details"] = choice_details

        return chunk, []


def create_provider(*, provider_config: Dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return NeuralwattProvider(provider_config)

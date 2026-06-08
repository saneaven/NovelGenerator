from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from ..shared.async_openai_provider import AsyncOpenAIProvider


OLLAMA_CLOUD_API_BASE = "https://ollama.com/api"
OLLAMA_CLOUD_OPENAI_BASE = "https://ollama.com/v1"


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _extract_model_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        models = payload.get("models")
        if isinstance(models, list):
            return [item for item in models if isinstance(item, dict)]
        data = payload.get("data")
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _project_model_item(item: dict[str, Any]) -> dict[str, Any] | None:
    model_id = item.get("model") or item.get("name") or item.get("id")
    if not isinstance(model_id, str) or not model_id.strip():
        return None
    projected = dict(item)
    projected["id"] = model_id.strip()
    return projected


class OllamaCloudProvider(AsyncOpenAIProvider):
    """Ollama Cloud provider using OpenAI-compatible chat completions."""

    @property
    def name(self) -> str:
        return "ollama_cloud"

    @property
    def display_name(self) -> str:
        return "Ollama Cloud"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    @property
    def base_url(self) -> str:
        return OLLAMA_CLOUD_OPENAI_BASE

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        details = self._snapshot_reasoning_details(final_snapshot)
        reasoning_text = self._reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not reasoning_text:
            return None

        data: dict[str, Any] = {}
        if reasoning_text:
            data["reasoning_text"] = reasoning_text
        if details:
            data["items"] = details

        return {
            "type": "ollama_cloud",
            "meta": {
                "provider": "ollama_cloud",
                "thinking_display": "reasoning_text",
            },
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return "reasoning_text"

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
            return {"reasoning_effort": "none"}
        if thinking_mode != "model" or not isinstance(thinking_config, dict):
            return None
        effort = thinking_config.get("effort")
        if effort not in {"low", "medium", "high"}:
            return None
        return {"reasoning_effort": effort}

    def _mutate_chunk(
        self,
        chunk: Dict,
        thinking_mode: Optional[str],
    ) -> Tuple[Optional[Dict], list[Dict]]:
        del thinking_mode
        choices = chunk.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            return chunk, []
        delta = choices[0].get("delta")
        if not isinstance(delta, dict):
            return chunk, []
        reasoning = delta.get("reasoning")
        if isinstance(reasoning, str) and "thinking" not in delta:
            delta["thinking"] = {"text": reasoning}
        thinking = delta.get("thinking")
        if isinstance(thinking, str):
            delta["thinking"] = {"text": thinking}
        return chunk, []

    async def get_models(self) -> Dict:
        import httpx

        api_key = str(self.api_key or "").strip()
        if not api_key:
            raise ValueError("Missing api_key for provider 'ollama_cloud'")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{OLLAMA_CLOUD_API_BASE}/tags", headers=_headers(api_key))
        if response.status_code >= 400:
            raise RuntimeError(f"Request failed ({response.status_code}): {response.text}")

        projected: list[dict[str, Any]] = []
        for item in _extract_model_items(response.json()):
            model = _project_model_item(item)
            if model is not None:
                projected.append(model)
        return {"data": projected}


def create_provider(*, provider_config: dict[str, object], runtime_spec: object):
    del runtime_spec
    return OllamaCloudProvider(provider_config)

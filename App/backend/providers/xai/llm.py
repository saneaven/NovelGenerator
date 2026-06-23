from typing import Any, Dict

from ..shared.async_openai_provider import AsyncOpenAIProvider


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

    def read_reasoning_detail(self, final_snapshot, advanced: dict[str, object]) -> dict[str, object] | None:
        details = self._snapshot_reasoning_details(final_snapshot)
        reasoning_text = self._reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not reasoning_text:
            return None

        data: dict[str, object] = {"details": details}
        meta: dict[str, object] = {"provider": "xai"}
        if reasoning_text:
            data["reasoning_text"] = reasoning_text
            meta["thinking_display"] = "reasoning_text"

        return {
            "type": "xai",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, object]) -> str | None:
        return "reasoning_text"

    def _prepare_request_kwargs(
        self,
        messages,
        model,
        temperature,
        tools,
        tool_choice,
        max_tokens,
        provider_preference,
        thinking_config,
        thinking_mode,
        provider_settings,
        cache_plan=None,
    ):
        request = super()._prepare_request_kwargs(
            messages,
            model,
            temperature,
            tools,
            tool_choice,
            max_tokens,
            provider_preference,
            thinking_config,
            thinking_mode,
            provider_settings,
            cache_plan,
        )
        cache_config = self._cache_config_from_provider_settings(provider_settings)
        if bool(cache_config.get("enabled", False)):
            cache_key = getattr(cache_plan, "thread_cache_key", None)
            if isinstance(cache_key, str) and cache_key:
                extra_headers = request.get("extra_headers") if isinstance(request.get("extra_headers"), dict) else {}
                request["extra_headers"] = {
                    **extra_headers,
                    "x-grok-conv-id": cache_key,
                }
        return request

    async def get_models(self) -> Dict:
        # /v1/models omits input_modalities; /v1/language-models includes it
        import httpx

        api_key = str(self.api_key or "").strip()
        if not api_key:
            raise ValueError("Missing api_key for provider 'xai'")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/language-models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if response.status_code >= 400:
            raise RuntimeError(f"Request failed ({response.status_code}): {response.text}")

        payload = response.json()
        raw_models: Any = None
        if isinstance(payload, dict):
            raw_models = payload.get("models")
            if not isinstance(raw_models, list):
                raw_models = payload.get("data")
        if not isinstance(raw_models, list):
            raw_models = payload if isinstance(payload, list) else []

        models: list[dict[str, Any]] = []
        for item in raw_models:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id") or item.get("model")
            if not isinstance(model_id, str) or not model_id.strip():
                continue
            entry = dict(item)
            entry["id"] = model_id.strip()
            models.append(entry)
        return {"data": models}


def create_provider(*, provider_config: dict[str, object], runtime_spec: object):
    del runtime_spec
    return XAIProvider(provider_config)

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
    # get_models() inherited from AsyncOpenAIProvider - xAI supports /v1/models endpoint


def create_provider(*, provider_config: dict[str, object], runtime_spec: object):
    del runtime_spec
    return XAIProvider(provider_config)

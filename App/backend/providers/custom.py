"""Custom endpoint provider using OpenAI-compatible Chat Completions only.

The custom provider always uses the OpenAI SDK transport and maps dialect-specific
extensions via `custom_api_format`:
- "openai": OpenAI-compatible fields (`reasoning_effort`)
- "claude": Anthropic OpenAI compatibility (`extra_body.thinking`)
- "gemini": Gemini OpenAI compatibility (`reasoning_effort` OR `extra_body.google.thinking_config`)
"""

from __future__ import annotations

from typing import AsyncGenerator, Dict, List, Optional

from .async_openai_provider import AsyncOpenAIProvider
from .registry import ProviderRegistry
from ..utils.outbound_http import filter_additional_headers, validate_outbound_base_url


@ProviderRegistry.register
class CustomProvider(AsyncOpenAIProvider):
    """Custom OpenAI-compatible endpoint provider."""

    def __init__(self, config: Dict):
        self._api_key = config.get("api_key")
        raw_base_url = (config.get("base_url") or "").strip()
        self._base_url = validate_outbound_base_url(raw_base_url) if raw_base_url else ""
        self._additional_headers = filter_additional_headers(config.get("additional_headers"))
        super().__init__(config)

    @property
    def name(self) -> str:
        return "custom"

    @property
    def display_name(self) -> str:
        return "Custom Endpoint"

    def validate_config(self) -> bool:
        # Custom endpoint requires base URL; API key is optional for self-hosted setups.
        return bool(self._base_url)

    @property
    def api_key(self) -> Optional[str]:
        return self._api_key

    @property
    def base_url(self) -> str:
        return self._base_url.rstrip("/")

    @property
    def default_headers(self) -> Dict[str, str]:
        return self._additional_headers

    @staticmethod
    def _normalize_custom_format(custom_api_format: Optional[str]) -> str:
        fmt = (custom_api_format or "openai").strip().lower()
        if fmt not in {"openai", "claude", "gemini"}:
            raise ValueError("custom_api_format must be one of: openai, claude, gemini")
        return fmt

    @staticmethod
    def _coerce_extra_body(request: Dict[str, object]) -> Dict[str, object]:
        existing = request.get("extra_body")
        return dict(existing) if isinstance(existing, dict) else {}

    def _prepare_request_kwargs(
        self,
        messages: List[Dict],
        model: str,
        temperature: float,
        tools: Optional[List[Dict]],
        tool_choice: Optional[str],
        max_tokens: Optional[int],
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
        custom_api_format: Optional[str] = None,
    ) -> Dict[str, object]:
        fmt = self._normalize_custom_format(custom_api_format)
        request = super()._prepare_request_kwargs(
            messages=messages,
            model=model,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=max_tokens,
            provider_preference=provider_preference,
            thinking_config=thinking_config,
            custom_api_format=custom_api_format,
        )

        cfg = thinking_config or {}
        effort = cfg.get("effort")
        claude_budget = cfg.get("claude_budget_tokens")
        gemini_level = cfg.get("gemini_thinking_level")
        gemini_budget = cfg.get("gemini_budget_tokens")

        if fmt == "openai":
            if effort is not None:
                request["reasoning_effort"] = effort
            return request

        if fmt == "claude":
            extra_body = self._coerce_extra_body(request)
            thinking_payload: Dict[str, object] = {"type": "enabled"}
            if claude_budget is not None:
                thinking_payload["budget_tokens"] = claude_budget
            extra_body["thinking"] = thinking_payload
            request["extra_body"] = extra_body
            return request

        # fmt == "gemini"
        has_reasoning_effort = effort is not None
        has_gemini_thinking_config = gemini_level is not None or gemini_budget is not None

        if has_reasoning_effort and has_gemini_thinking_config:
            raise ValueError(
                "custom_api_format=gemini requires choosing either reasoning_effort "
                "or google.thinking_config (thinking_level/thinking_budget), not both."
            )

        if has_reasoning_effort:
            if effort not in {"none", "low", "medium", "high"}:
                raise ValueError(
                    "custom_api_format=gemini supports reasoning_effort values: none, low, medium, high."
                )
            request["reasoning_effort"] = effort
            return request

        if has_gemini_thinking_config:
            extra_body = self._coerce_extra_body(request)
            google_body = dict(extra_body.get("google") or {})
            thinking_payload: Dict[str, object] = {"include_thoughts": True}
            if gemini_level is not None:
                thinking_payload["thinking_level"] = gemini_level
            if gemini_budget is not None:
                thinking_payload["thinking_budget"] = gemini_budget
            google_body["thinking_config"] = thinking_payload
            extra_body["google"] = google_body
            request["extra_body"] = extra_body
            return request

        return request

    async def stream_chat(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        tools: Optional[List[Dict]] = None,
        tool_choice: Optional[str] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None,
        thinking_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None,
        custom_api_format: Optional[str] = None,
        retry_config: Optional[Dict] = None,
        native_tool_call: bool = False,
    ) -> AsyncGenerator[bytes, None]:
        # Custom dialect-specific thinking fields are only sent in model thinking mode.
        effective_thinking_config = thinking_config if thinking_mode == "model" else None
        async for chunk in super().stream_chat(
            messages=messages,
            model=model,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=max_tokens,
            provider_preference=provider_preference,
            thinking_config=effective_thinking_config,
            thinking_mode=thinking_mode,
            custom_api_format=custom_api_format,
            retry_config=retry_config,
            native_tool_call=native_tool_call,
        ):
            yield chunk

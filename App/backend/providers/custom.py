"""Custom endpoint provider with explicit request format routing.

Supported request formats:
- openai_sdk: OpenAI-compatible Chat Completions transport + thinking_format mapping.
- claude_sdk: Anthropic Messages transport + Claude-native request shape.
"""

from __future__ import annotations

from typing import AsyncGenerator, Dict, List, Optional, Literal, cast

from anthropic import AsyncAnthropic

from .async_openai_provider import AsyncOpenAIProvider
from .claude_provider import ClaudeProvider
from .contracts import ProviderEvent
from .registry import ProviderRegistry
from ..utils.outbound_http import (
    filter_additional_body,
    filter_additional_headers,
    merge_user_overrides,
    validate_outbound_base_url,
)


RequestFormat = Literal["openai_sdk", "claude_sdk"]
ThinkingFormat = Literal["openai", "claude", "gemini"]


class _CustomClaudeSDKProvider(ClaudeProvider):
    """Internal Claude SDK transport for custom endpoints."""

    def __init__(self, config: Dict):
        self._api_key = config.get("api_key")
        raw_base_url = (config.get("base_url") or "").strip()
        self._base_url = validate_outbound_base_url(raw_base_url) if raw_base_url else ""
        self._additional_headers = filter_additional_headers(config.get("additional_headers"))
        self._additional_body = filter_additional_body(config.get("additional_body"))
        super().__init__(config)

    @property
    def name(self) -> str:
        # Must start with custom_ to allow base_url override in parent implementation.
        return "custom_claude_sdk"

    @property
    def display_name(self) -> str:
        return "Custom Claude SDK"

    @property
    def api_key(self) -> Optional[str]:
        return self._api_key

    def validate_config(self) -> bool:
        # Base URL is required. API key can be optional for self-hosted gateways.
        return bool(self._base_url)

    def _build_client(self) -> AsyncAnthropic:
        kwargs: Dict[str, object] = {
            "api_key": (self._api_key or "custom-endpoint-key"),
            "base_url": self._base_url.rstrip("/"),
        }
        if self._additional_headers:
            kwargs["default_headers"] = self._additional_headers
        return AsyncAnthropic(**kwargs)

    def _additional_request_body(self) -> Dict[str, object]:
        return dict(self._additional_body)


@ProviderRegistry.register
class CustomProvider(AsyncOpenAIProvider):
    """Custom endpoint provider supporting OpenAI/Claude SDK request formats."""

    def __init__(self, config: Dict):
        self._api_key = config.get("api_key")
        raw_base_url = (config.get("base_url") or "").strip()
        self._base_url = validate_outbound_base_url(raw_base_url) if raw_base_url else ""
        self._additional_headers = filter_additional_headers(config.get("additional_headers"))
        self._additional_body = filter_additional_body(config.get("additional_body"))
        self._request_format = self._normalize_request_format(config.get("request_format"))
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
    def _normalize_request_format(request_format: Optional[str]) -> RequestFormat:
        value = (request_format or "openai_sdk").strip().lower()
        if value not in {"openai_sdk", "claude_sdk"}:
            raise ValueError("request_format must be one of: openai_sdk, claude_sdk")
        return cast(RequestFormat, value)

    @staticmethod
    def _normalize_thinking_format(thinking_format: Optional[str]) -> ThinkingFormat:
        fmt = (thinking_format or "openai").strip().lower()
        if fmt not in {"openai", "claude", "gemini"}:
            raise ValueError("thinking_format must be one of: openai, claude, gemini")
        return cast(ThinkingFormat, fmt)

    @staticmethod
    def _coerce_extra_body(request: Dict[str, object]) -> Dict[str, object]:
        existing = request.get("extra_body")
        return dict(existing) if isinstance(existing, dict) else {}

    def _apply_additional_body(self, request: Dict[str, object]) -> Dict[str, object]:
        if not self._additional_body:
            return request
        extra_body = self._coerce_extra_body(request)
        request["extra_body"] = merge_user_overrides(extra_body, self._additional_body)
        return request

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
        thinking_format: Optional[str] = None,
    ) -> Dict[str, object]:
        fmt = self._normalize_thinking_format(thinking_format)
        request = super()._prepare_request_kwargs(
            messages=messages,
            model=model,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=max_tokens,
            provider_preference=provider_preference,
            thinking_config=thinking_config,
            thinking_format=thinking_format,
        )

        cfg = thinking_config or {}
        effort = cfg.get("effort")
        gemini_level = cfg.get("gemini_thinking_level")
        gemini_budget = cfg.get("gemini_budget_tokens")

        if fmt == "openai":
            if effort is not None:
                request["reasoning_effort"] = effort
            return self._apply_additional_body(request)

        if fmt == "claude":
            extra_body = self._coerce_extra_body(request)
            normalized_effort = "high"
            if isinstance(effort, str) and effort.strip():
                normalized_effort = effort.strip().lower()
            if normalized_effort not in {"low", "medium", "high", "max"}:
                raise ValueError(
                    "thinking_format=claude supports effort values: low, medium, high, max."
                )

            thinking_payload: Dict[str, object] = {"type": "adaptive"}
            output_config = dict(extra_body.get("output_config") or {})
            output_config["effort"] = normalized_effort
            extra_body["thinking"] = thinking_payload
            extra_body["output_config"] = output_config
            request["extra_body"] = extra_body
            return self._apply_additional_body(request)

        # fmt == "gemini"
        has_reasoning_effort = effort is not None
        has_gemini_thinking_config = gemini_level is not None or gemini_budget is not None

        if has_reasoning_effort and has_gemini_thinking_config:
            raise ValueError(
                "thinking_format=gemini requires choosing either reasoning_effort "
                "or google.thinking_config (thinking_level/thinking_budget), not both."
            )

        if has_reasoning_effort:
            if effort not in {"none", "low", "medium", "high"}:
                raise ValueError(
                    "thinking_format=gemini supports reasoning_effort values: none, low, medium, high."
                )
            request["reasoning_effort"] = effort
            return self._apply_additional_body(request)

        if has_gemini_thinking_config:
            extra_body = self._coerce_extra_body(request)
            wrapped_extra_body = dict(extra_body.get("extra_body") or {})
            google_body = dict(wrapped_extra_body.get("google") or {})
            thinking_payload: Dict[str, object] = {"include_thoughts": True}
            if gemini_level is not None:
                thinking_payload["thinking_level"] = gemini_level
            if gemini_budget is not None:
                thinking_payload["thinking_budget"] = gemini_budget
            google_body["thinking_config"] = thinking_payload
            wrapped_extra_body["google"] = google_body
            extra_body["extra_body"] = wrapped_extra_body
            request["extra_body"] = extra_body
            return self._apply_additional_body(request)

        return self._apply_additional_body(request)

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
        thinking_format: Optional[str] = None,
        request_format: Optional[str] = None,
        retry_config: Optional[Dict] = None,
        native_tool_call: bool = False,
    ) -> AsyncGenerator[ProviderEvent, None]:
        effective_request_format = self._normalize_request_format(request_format or self._request_format)

        if effective_request_format == "claude_sdk":
            if thinking_format and thinking_format != "claude":
                raise ValueError(
                    "request_format=claude_sdk does not support thinking_format values other than 'claude'."
                )

            claude_provider = _CustomClaudeSDKProvider(
                {
                    "api_key": self._api_key,
                    "base_url": self._base_url,
                    "additional_headers": self._additional_headers,
                    "additional_body": self._additional_body,
                }
            )
            async for event in claude_provider.stream_chat(
                messages=messages,
                model=model,
                temperature=temperature,
                tools=tools,
                tool_choice=tool_choice,
                max_tokens=max_tokens,
                provider_preference=provider_preference,
                thinking_config=thinking_config,
                thinking_mode=thinking_mode,
                thinking_format=thinking_format,
                request_format=effective_request_format,
                retry_config=retry_config,
                native_tool_call=native_tool_call,
            ):
                yield event
            return

        # openai_sdk path
        # Custom dialect-specific thinking fields are only sent in model thinking mode.
        effective_thinking_config = thinking_config if thinking_mode == "model" else None
        async for event in super().stream_chat(
            messages=messages,
            model=model,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=max_tokens,
            provider_preference=provider_preference,
            thinking_config=effective_thinking_config,
            thinking_mode=thinking_mode,
            thinking_format=thinking_format,
            request_format=effective_request_format,
            retry_config=retry_config,
            native_tool_call=native_tool_call,
        ):
            yield event

    async def get_models(self) -> Dict:
        effective_request_format = self._normalize_request_format(self._request_format)
        if effective_request_format == "claude_sdk":
            claude_provider = _CustomClaudeSDKProvider(
                {
                    "api_key": self._api_key,
                    "base_url": self._base_url,
                    "additional_headers": self._additional_headers,
                    "additional_body": self._additional_body,
                }
            )
            return await claude_provider.get_models()

        return await super().get_models()

"""Custom endpoint provider with explicit request format routing.

Supported request formats:
- openai_sdk: OpenAI-compatible Chat Completions transport + template-based thinking.
- claude_sdk: Anthropic Messages transport + Claude-native request shape.
"""

from __future__ import annotations

from typing import AsyncGenerator, Dict, List, Optional, Literal, Tuple, cast

from anthropic import AsyncAnthropic

from .async_openai_provider import AsyncOpenAIProvider
from .claude_provider import ClaudeProvider
from .contracts import ProviderEvent
from .registry import ProviderRegistry
from ..services.reasoning.custom_template_runtime import (
    apply_effort_fields,
    extract_response_fields,
    set_nested_path,
)
from ..utils.outbound_http import (
    filter_additional_body,
    filter_additional_headers,
    merge_user_overrides,
    validate_outbound_base_url,
)


RequestFormat = Literal["openai_sdk", "claude_sdk"]


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
        self._current_thinking_template: Optional[Dict] = None
        super().__init__(config)

    def set_thinking_template(self, template: Optional[Dict]) -> None:
        """Set the compiled thinking template for the next stream_chat call."""
        self._current_thinking_template = template

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
    ) -> Dict[str, object]:
        request = super()._prepare_request_kwargs(
            messages=messages,
            model=model,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=max_tokens,
            provider_preference=provider_preference,
            thinking_config=thinking_config,
        )

        if self._current_thinking_template:
            apply_effort_fields(request, self._current_thinking_template.get("effort_fields") or [])

        return self._apply_additional_body(request)

    # ----- Streaming: template response field extraction -----

    def _mutate_chunk(
        self,
        chunk: Dict,
        thinking_mode: Optional[str],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        if not self._current_thinking_template:
            return chunk, []

        choices = chunk.get("choices")
        if not choices or not isinstance(choices, list):
            return chunk, []

        first_choice = choices[0] if isinstance(choices[0], dict) else {}
        delta = first_choice.get("delta")
        if not isinstance(delta, dict):
            return chunk, []

        response_fields = self._current_thinking_template.get("response_fields") or []
        items, thinking_text = extract_response_fields(delta, response_fields)

        if thinking_text:
            delta.setdefault("thinking", {})["text"] = thinking_text

        if items:
            existing = delta.get("reasoning_details")
            if isinstance(existing, list):
                existing.extend(items)
            else:
                delta["reasoning_details"] = items

        return chunk, []

    # ----- History: template history field injection -----

    def _convert_messages(self, messages: List[Dict]) -> List[Dict]:
        converted = super()._convert_messages(messages)
        if not self._current_thinking_template:
            return converted

        # Map original messages to converted messages (tool_results expand 1:N).
        conv_idx = 0
        for orig in messages:
            if orig.get("role") == "tool_results":
                conv_idx += len(orig.get("tool_results") or [])
                continue
            inject = orig.get("_template_history_inject")
            if isinstance(inject, dict) and inject and conv_idx < len(converted):
                for path, value in inject.items():
                    set_nested_path(converted[conv_idx], path, value)
                converted[conv_idx].pop("reasoning", None)
                converted[conv_idx].pop("reasoning_details", None)
            conv_idx += 1

        return converted

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
        request_format: Optional[str] = None,
        retry_config: Optional[Dict] = None,
        native_tool_call: bool = False,
        verbosity: Optional[str] = None,
    ) -> AsyncGenerator[ProviderEvent, None]:
        effective_request_format = self._normalize_request_format(request_format or self._request_format)

        if effective_request_format == "claude_sdk":
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

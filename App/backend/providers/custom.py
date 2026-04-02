"""Custom endpoint provider with explicit custom kind routing.

Supported custom kinds:
- openai_completion: OpenAI-compatible Chat Completions transport + template-based thinking.
- openai_response: OpenAI Responses API transport + native reasoning support.
- claude: Anthropic Messages transport + Claude-native request shape.
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Dict, List, Literal, Optional, Tuple, cast

from anthropic import AsyncAnthropic
from openai import AsyncOpenAI, OpenAIError

from .async_openai_provider import AsyncOpenAIProvider
from .client_timeouts import get_llm_stream_timeout
from .claude_provider import ClaudeProvider
from .contracts import ProviderEvent
from .openai_responses_provider import OpenAIResponsesProvider
from .registry import ProviderRegistry
from ..services.reasoning.custom_template_runtime import (
    apply_effort_fields,
    build_history_inject,
    extract_response_fields,
    get_nested_path,
    set_nested_path,
)
from ..utils.outbound_http import (
    filter_additional_body,
    filter_additional_headers,
    merge_user_overrides,
    validate_outbound_base_url,
)
from ..utils.template_vars import resolve_value


def build_request_context(run: Any, thread: Any, provider_messages: list[Dict], task_config: Any) -> Dict[str, Any]:
    """Build the Jinja2 template context for custom provider headers/body."""
    last_role = ""
    for msg in reversed(provider_messages):
        role = msg.get("role", "")
        if role in ("user", "assistant"):
            last_role = role
            break
    return {
        "run_id": str(run.id),
        "thread_id": str(thread.id),
        "thread_type": str(thread.thread_type or ""),
        "is_sub_agent": thread.thread_type == "subAgent",
        "parent_run_id": str(run.parent_run_id or ""),
        "last_role": last_role,
        "model": str(getattr(task_config, "model", "") or ""),
        "run_seq": str(getattr(run, "run_seq", "") or ""),
    }


CustomKind = Literal["openai_completion", "openai_response", "claude"]


class _CustomClaudeProvider(ClaudeProvider):
    """Internal Claude transport for custom endpoints."""

    def __init__(self, config: Dict):
        self._api_key = config.get("api_key")
        raw_base_url = (config.get("base_url") or "").strip()
        self._base_url = validate_outbound_base_url(raw_base_url) if raw_base_url else ""
        self._additional_headers = filter_additional_headers(config.get("additional_headers"))
        self._additional_body = filter_additional_body(config.get("additional_body"))
        self._request_context: Dict[str, Any] = {}
        self._resolved_headers: Dict[str, str] = {}
        self._resolved_body: Dict[str, Any] = {}
        super().__init__(config)

    @property
    def name(self) -> str:
        # Must start with custom_ to allow base_url override in parent implementation.
        return "custom_claude"

    @property
    def display_name(self) -> str:
        return "Custom Claude"

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
            "timeout": get_llm_stream_timeout(),
        }
        if self._additional_headers:
            kwargs["default_headers"] = self._additional_headers
        return AsyncAnthropic(**kwargs)

    def _get_extra_headers(self) -> Dict[str, str]:
        return self._resolved_headers

    def _additional_request_body(self) -> Dict[str, object]:
        if self._request_context:
            return dict(self._resolved_body)
        return dict(self._additional_body)


class _CustomOpenAIResponseProvider(OpenAIResponsesProvider):
    """Internal OpenAI Responses API transport for custom endpoints."""

    def __init__(self, config: Dict):
        self._api_key = config.get("api_key")
        raw_base_url = (config.get("base_url") or "").strip()
        self._base_url = validate_outbound_base_url(raw_base_url) if raw_base_url else ""
        self._additional_headers = filter_additional_headers(config.get("additional_headers"))
        self._additional_body = filter_additional_body(config.get("additional_body"))
        self._request_context: Dict[str, Any] = {}
        self._resolved_headers: Dict[str, str] = {}
        self._resolved_body: Dict[str, Any] = {}
        super().__init__(config)

    @property
    def name(self) -> str:
        return "custom_openai_response"

    @property
    def display_name(self) -> str:
        return "Custom OpenAI Response"

    @property
    def api_key(self) -> Optional[str]:
        return self._api_key

    def validate_config(self) -> bool:
        # Base URL is required. API key can be optional for self-hosted gateways.
        return bool(self._base_url)

    def _build_client(self) -> AsyncOpenAI:
        kwargs: Dict[str, object] = {
            "api_key": (self._api_key or "custom-endpoint-key"),
            "base_url": self._base_url.rstrip("/"),
            "timeout": get_llm_stream_timeout(),
        }
        if self._additional_headers:
            kwargs["default_headers"] = self._additional_headers
        return AsyncOpenAI(**kwargs)

    def _prepare_responses_request(self, **kwargs) -> Dict:
        request = super()._prepare_responses_request(**kwargs)
        body = self._resolved_body if self._request_context else self._additional_body
        if body:
            existing = request.get("extra_body")
            base = dict(existing) if isinstance(existing, dict) else {}
            request["extra_body"] = merge_user_overrides(base, body)
        if self._request_context and self._resolved_headers:
            request["extra_headers"] = self._resolved_headers
        return request

    async def get_models(self) -> Dict:
        """No regex filtering — custom endpoint may serve any model."""
        client = self._ensure_client()
        try:
            models = await client.models.list()
            return {"data": [m.model_dump() for m in models.data]}
        except OpenAIError as exc:
            raise Exception(f"Error fetching models: {exc}") from exc


@ProviderRegistry.register
class CustomProvider(AsyncOpenAIProvider):
    """Custom endpoint provider supporting custom transport kinds."""

    def __init__(self, config: Dict):
        self._api_key = config.get("api_key")
        raw_base_url = (config.get("base_url") or "").strip()
        self._base_url = validate_outbound_base_url(raw_base_url) if raw_base_url else ""
        self._additional_headers = filter_additional_headers(config.get("additional_headers"))
        self._additional_body = filter_additional_body(config.get("additional_body"))
        self._custom_kind = self._normalize_custom_kind(config.get("custom_kind"))
        self._current_thinking_template: Optional[Dict] = None
        self._active_custom_kind: CustomKind = self._custom_kind
        self._request_context: Dict[str, Any] = {}
        self._resolved_headers: Dict[str, str] = {}
        self._resolved_body: Dict[str, Any] = {}
        super().__init__(config)

    def set_request_context(self, ctx: Dict[str, Any]) -> None:
        """Set per-request template variable context for Jinja2 resolution."""
        self._request_context = ctx
        self._resolved_headers = resolve_value(self._additional_headers, ctx)
        self._resolved_body = resolve_value(self._additional_body, ctx) if self._additional_body else {}

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
    def _normalize_custom_kind(custom_kind: Optional[str]) -> CustomKind:
        value = (custom_kind or "openai_completion").strip().lower()
        if value not in {"openai_completion", "openai_response", "claude"}:
            raise ValueError("custom_kind must be one of: openai_completion, openai_response, claude")
        return cast(CustomKind, value)

    @staticmethod
    def _coerce_extra_body(request: Dict[str, object]) -> Dict[str, object]:
        existing = request.get("extra_body")
        return dict(existing) if isinstance(existing, dict) else {}

    def _apply_additional_body(self, request: Dict[str, object]) -> Dict[str, object]:
        body = self._resolved_body if self._request_context else self._additional_body
        if not body:
            return request
        extra_body = self._coerce_extra_body(request)
        request["extra_body"] = merge_user_overrides(extra_body, body)
        return request

    @staticmethod
    def _append_string_path(target: dict[str, Any], path: str, value: str) -> None:
        existing = get_nested_path(target, path)
        if isinstance(existing, str):
            set_nested_path(target, path, existing + value)
        else:
            set_nested_path(target, path, value)

    @staticmethod
    def _first_stream_template_var(template: dict[str, Any] | None) -> str | None:
        if not isinstance(template, dict):
            return None
        response_fields = template.get("response_fields")
        if not isinstance(response_fields, list):
            return None
        for field in response_fields:
            if not isinstance(field, dict):
                continue
            if not bool(field.get("is_stream_delta")):
                continue
            as_var = field.get("as_var")
            if isinstance(as_var, str) and as_var.strip():
                return as_var.strip()
        return None

    def _effective_custom_kind(self, custom_kind: Optional[str]) -> CustomKind:
        return self._normalize_custom_kind(custom_kind or self._custom_kind)

    def _propagate_request_context(self, delegate: Any) -> None:
        delegate._request_context = self._request_context
        delegate._resolved_headers = self._resolved_headers
        delegate._resolved_body = self._resolved_body

    def _build_claude_delegate(self) -> _CustomClaudeProvider:
        delegate = _CustomClaudeProvider(
            {
                "api_key": self._api_key,
                "base_url": self._base_url,
                "additional_headers": self._additional_headers,
                "additional_body": self._additional_body,
            }
        )
        self._propagate_request_context(delegate)
        return delegate

    def _build_openai_response_delegate(self) -> _CustomOpenAIResponseProvider:
        delegate = _CustomOpenAIResponseProvider(
            {
                "api_key": self._api_key,
                "base_url": self._base_url,
                "additional_headers": self._additional_headers,
                "additional_body": self._additional_body,
            }
        )
        self._propagate_request_context(delegate)
        return delegate

    def _prepare_completion_messages(self, messages: List[Dict]) -> List[Dict]:
        prepared = self._copy_messages(messages)
        template = self._current_thinking_template
        template_id = template.get("id") if isinstance(template, dict) else None

        for message in prepared:
            if message.get("role") != "assistant":
                continue
            reasoning_detail = message.get("reasoning_detail")
            if not isinstance(reasoning_detail, dict):
                continue

            if not isinstance(template, dict) or not isinstance(template_id, str) or not template_id:
                message.pop("reasoning_detail", None)
                continue

            meta = reasoning_detail.get("meta") if isinstance(reasoning_detail.get("meta"), dict) else {}
            detail_tid = meta.get("custom_thinking_template_id")
            if detail_tid != template_id:
                message.pop("reasoning_detail", None)
                continue

            if reasoning_detail.get("type") == "openai_compatible_template":
                data = reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}
                inject = build_history_inject(data, template.get("history_fields") or [])
                if inject:
                    message["_template_history_inject"] = inject
            message.pop("reasoning_detail", None)

        return prepared

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

        request = self._apply_additional_body(request)
        if self._request_context and self._resolved_headers:
            request["extra_headers"] = self._resolved_headers
        return request

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
        prepared_messages = self._prepare_completion_messages(messages)
        converted = super()._convert_messages(prepared_messages)
        if not self._current_thinking_template:
            return converted

        # Map original messages to converted messages (tool_results expand 1:N).
        conv_idx = 0
        for orig in prepared_messages:
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
        custom_kind: Optional[str] = None,
        native_tool_call: bool = False,
        verbosity: Optional[str] = None,
    ) -> AsyncGenerator[ProviderEvent, None]:
        effective_custom_kind = self._effective_custom_kind(custom_kind)
        self._active_custom_kind = effective_custom_kind

        if effective_custom_kind == "claude":
            claude_provider = self._build_claude_delegate()
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
                custom_kind=effective_custom_kind,
                native_tool_call=native_tool_call,
            ):
                yield event
            return

        if effective_custom_kind == "openai_response":
            responses_provider = self._build_openai_response_delegate()
            async for event in responses_provider.stream_chat(
                messages=messages,
                model=model,
                temperature=temperature,
                tools=tools,
                tool_choice=tool_choice,
                max_tokens=max_tokens,
                provider_preference=provider_preference,
                thinking_config=thinking_config if thinking_mode == "model" else None,
                thinking_mode=thinking_mode,
                custom_kind=effective_custom_kind,
                native_tool_call=native_tool_call,
                verbosity=verbosity,
            ):
                yield event
            return

        # openai_completion path
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
            custom_kind=effective_custom_kind,
            native_tool_call=native_tool_call,
        ):
            yield event

    async def get_models(self) -> Dict:
        effective_custom_kind = self._normalize_custom_kind(self._custom_kind)
        if effective_custom_kind == "claude":
            claude_provider = self._build_claude_delegate()
            return await claude_provider.get_models()

        if effective_custom_kind == "openai_response":
            responses_provider = self._build_openai_response_delegate()
            return await responses_provider.get_models()

        return await super().get_models()

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        effective_custom_kind = self._effective_custom_kind(advanced.get("custom_kind"))
        if effective_custom_kind == "claude":
            return self._build_claude_delegate().read_reasoning_detail(final_snapshot, advanced)
        if effective_custom_kind == "openai_response":
            return self._build_openai_response_delegate().read_reasoning_detail(final_snapshot, advanced)

        template_id = advanced.get("custom_thinking_template_id")
        details = self._snapshot_reasoning_details(final_snapshot)
        thinking_text = self._reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))

        if template_id:
            var_data: dict[str, Any] = {}
            for item in details:
                var_name = item.get("_template_var")
                value = item.get("value")
                if not isinstance(var_name, str) or not var_name.strip():
                    continue
                path = var_name.strip()
                if isinstance(value, str):
                    self._append_string_path(var_data, path, value)
                elif value is not None:
                    set_nested_path(var_data, path, value)

            if not var_data:
                return None

            meta: dict[str, Any] = {
                "provider": "custom",
                "custom_thinking_template_id": template_id,
            }
            stream_path = self.get_stream_thinking_display_path(advanced)
            if stream_path:
                meta["thinking_display"] = stream_path

            return {
                "type": "openai_compatible_template",
                "meta": meta,
                "data": var_data,
                "token_count": 0,
            }

        if not thinking_text.strip():
            return None
        return {
            "type": "custom",
            "meta": {
                "provider": "custom",
                "thinking_display": "text",
            },
            "data": {"text": thinking_text},
            "token_count": 0,
        }

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        if self._active_custom_kind == "claude":
            return self._build_claude_delegate().read_reasoning_tokens(final_snapshot)
        if self._active_custom_kind == "openai_response":
            return self._build_openai_response_delegate().read_reasoning_tokens(final_snapshot)
        return super().read_reasoning_tokens(final_snapshot)

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        effective_custom_kind = self._effective_custom_kind(advanced.get("custom_kind"))
        if effective_custom_kind == "claude":
            return self._build_claude_delegate().get_stream_thinking_display_path(advanced)
        if effective_custom_kind == "openai_response":
            return self._build_openai_response_delegate().get_stream_thinking_display_path(advanced)

        template_id = advanced.get("custom_thinking_template_id")
        if template_id:
            template = advanced.get("_resolved_template") if isinstance(advanced.get("_resolved_template"), dict) else None
            return self._first_stream_template_var(template)
        return "text"

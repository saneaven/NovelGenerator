import copy
from typing import AsyncGenerator, Dict, List, Optional, Tuple

from openai import (
    APIConnectionError,
    APIStatusError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    OpenAIError,
    RateLimitError,
)

from .base import BaseProvider
from .contracts import DeltaPayload, MetaPayload, ProviderErrorPayload, ProviderEvent
from .native_tool_calls_parser import NativeToolCallsStreamParser
from .thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag
from ..utils.outbound_http import validate_outbound_base_url

class AsyncOpenAIProvider(BaseProvider):
    """Reusable base class for providers backed by OpenAI-compatible chat completions."""

    models_endpoint: str = "/models"

    def __init__(self, config: Dict):
        super().__init__(config)
        self._client: Optional[AsyncOpenAI] = None
        if self.validate_config():
            self._client = self._build_client()

    # ----- Client configuration hooks -------------------------------------------------
    @property
    def api_key(self) -> Optional[str]:
        return self.config.get("api_key")

    @property
    def base_url(self) -> str:
        url = (self.config.get("base_url") or "").strip()
        if url:
            return validate_outbound_base_url(url).rstrip("/")
        return "https://api.openai.com/v1"

    @property
    def default_headers(self) -> Dict[str, str]:
        return self.config.get("additional_headers") or {}

    def _build_client(self) -> AsyncOpenAI:
        client_kwargs: Dict[str, object] = {"base_url": self.base_url}
        if self.api_key:
            client_kwargs["api_key"] = self.api_key
        if self.default_headers:
            client_kwargs["default_headers"] = self.default_headers
        return AsyncOpenAI(**client_kwargs)

    def _ensure_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    # ----- Request preparation hooks --------------------------------------------------
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
        is_gpt5 = self._is_gpt5_model(model)

        request: Dict[str, object] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }

        # GPT-5 doesn't support temperature parameter
        if not is_gpt5:
            request["temperature"] = temperature

        # GPT-5 uses max_output_tokens instead of max_tokens
        if max_tokens is not None:
            if is_gpt5:
                request["max_output_tokens"] = max_tokens
            else:
                request["max_tokens"] = max_tokens

        if tools:
            request["tools"] = [{"type": "function", "function": fn} for fn in tools]
            request["tool_choice"] = tool_choice or "auto"

        extra_body = self._build_extra_body(provider_preference, thinking_config, model)
        if extra_body:
            request["extra_body"] = extra_body

        additional = self._additional_request_kwargs()
        if additional:
            request.update(additional)

        return request

    def _build_extra_body(
        self,
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
        model: str = "",
    ) -> Optional[Dict]:
        return None

    def _is_gpt5_model(self, model: str) -> bool:
        """Check if model is GPT-5 family. Override in subclasses if needed."""
        return False

    def _additional_request_kwargs(self) -> Dict[str, object]:
        return {}

    def _convert_messages(self, messages: List[Dict]) -> List[Dict]:
        """Convert messages to OpenAI Chat Completions format.

        Handles tool_results messages by converting to role: "tool" messages.
        """
        converted: List[Dict] = []
        for msg in messages:
            role = msg.get("role", "user")

            if role == "tool_results":
                # OpenAI: separate message per tool result with role "tool"
                tool_results = msg.get("tool_results", [])
                for tr in tool_results:
                    tool_msg: Dict[str, object] = {
                        "role": "tool",
                        "tool_call_id": tr.get("tool_call_id", ""),
                        "content": tr.get("content", ""),
                    }
                    tool_name = tr.get("tool_name")
                    if tool_name:
                        tool_msg["name"] = tool_name
                    converted.append(tool_msg)
                continue

            converted_msg: Dict[str, object] = {
                "role": role,
                "content": self._extract_text_content(msg),
            }
            tool_calls = msg.get("tool_calls")
            if role == "assistant" and isinstance(tool_calls, list) and tool_calls:
                converted_msg["tool_calls"] = tool_calls

            converted.append(converted_msg)

        return converted

    # ----- Streaming hooks ------------------------------------------------------------
    def _mutate_chunk(
        self,
        chunk: Dict,
        thinking_mode: Optional[str],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        return chunk, []

    # ----- Public API -----------------------------------------------------------------
    @staticmethod
    def _error_event(message: str, status: Optional[int] = None) -> ProviderEvent:
        return ProviderEvent(
            kind="error",
            error=ProviderErrorPayload(message=message, status=status),
        )

    @staticmethod
    def _chunk_to_events(chunk: Optional[Dict]) -> List[ProviderEvent]:
        if not isinstance(chunk, dict):
            return []

        events: List[ProviderEvent] = []

        usage = chunk.get("usage")
        if isinstance(usage, dict):
            events.append(
                ProviderEvent(
                    kind="meta",
                    meta=MetaPayload(
                        usage={
                            "prompt_tokens": int(usage.get("prompt_tokens", 0) or 0),
                            "completion_tokens": int(usage.get("completion_tokens", 0) or 0),
                            "total_tokens": int(usage.get("total_tokens", 0) or 0),
                        }
                    ),
                )
            )

        choices = chunk.get("choices") or []
        if not choices:
            return events

        choice = choices[0] if isinstance(choices[0], dict) else {}
        finish_reason = choice.get("finish_reason")
        if finish_reason is not None:
            events.append(
                ProviderEvent(
                    kind="meta",
                    meta=MetaPayload(finish_reason=str(finish_reason)),
                )
            )

        delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
        content_delta = delta.get("content") if isinstance(delta.get("content"), str) else None

        thinking_delta = None
        thinking_obj = delta.get("thinking")
        if isinstance(thinking_obj, dict) and isinstance(thinking_obj.get("text"), str):
            thinking_delta = thinking_obj.get("text")

        tool_call_deltas = delta.get("tool_calls") if isinstance(delta.get("tool_calls"), list) else []
        thinking_details = delta.get("thinking_details") if isinstance(delta.get("thinking_details"), list) else []

        if content_delta or thinking_delta or tool_call_deltas or thinking_details:
            events.append(
                ProviderEvent(
                    kind="delta",
                    delta=DeltaPayload(
                        content_delta=content_delta,
                        thinking_delta=thinking_delta,
                        tool_call_deltas=tool_call_deltas,
                        thinking_details_delta=thinking_details,
                    ),
                )
            )

        return events

    @staticmethod
    def _has_meaningful_payload(chunk: Dict) -> bool:
        choices = chunk.get("choices", [])
        for choice in choices:
            delta = choice.get("delta") or {}
            if delta:
                return True
            if choice.get("finish_reason") is not None:
                return True
        return False

    def _apply_thinking_parser(
        self,
        chunk: Optional[Dict],
        parser: Optional[ThinkingStreamParser],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        if parser is None or chunk is None:
            return chunk, []

        choices = chunk.get("choices")
        if not choices:
            return chunk, []

        first_choice = choices[0]
        delta = copy.deepcopy(first_choice.get("delta") or {})
        if not delta:
            return chunk, []

        content = delta.get("content")
        extra_chunks: List[Dict] = []

        if isinstance(content, str) and content:
            clean_content, thinking_block = parser.process_chunk(content)
            if clean_content:
                delta["content"] = clean_content
            else:
                delta.pop("content", None)

            if thinking_block:
                extra_chunks.append(
                    {"choices": [{"delta": {"thinking": {"text": thinking_block}}}]}
                )

        updated_choice = copy.deepcopy(first_choice)
        updated_choice["delta"] = delta
        updated_chunk = copy.deepcopy(chunk)
        updated_chunk["choices"][0] = updated_choice

        if not self._has_meaningful_payload(updated_chunk):
            updated_chunk = None

        return updated_chunk, extra_chunks

    def _apply_native_tool_calls_parser(
        self,
        chunk: Optional[Dict],
        parser: Optional[NativeToolCallsStreamParser],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        if parser is None or chunk is None:
            return chunk, []

        choices = chunk.get("choices")
        if not choices:
            return chunk, []

        first_choice = choices[0]
        delta = copy.deepcopy(first_choice.get("delta") or {})
        if not delta:
            return chunk, []

        content = delta.get("content")
        extra_chunks: List[Dict] = []

        if isinstance(content, str) and content:
            clean_content, tool_calls = parser.process_chunk(content)
            if clean_content:
                delta["content"] = clean_content
            else:
                delta.pop("content", None)

            if tool_calls:
                extra_chunks.append(
                    {"choices": [{"delta": {"tool_calls": tool_calls}}]}
                )

        updated_choice = copy.deepcopy(first_choice)
        updated_choice["delta"] = delta
        updated_chunk = copy.deepcopy(chunk)
        updated_chunk["choices"][0] = updated_choice

        if not self._has_meaningful_payload(updated_chunk):
            updated_chunk = None

        return updated_chunk, extra_chunks

    def _finalize_parser(
        self,
        parser: Optional[ThinkingStreamParser],
    ) -> List[Dict]:
        if parser is None:
            return []

        final_chunks: List[Dict] = []
        final_content, final_thinking = parser.finalize()
        if final_content:
            final_chunks.append({"choices": [{"delta": {"content": final_content}}]})
        if final_thinking:
            final_chunks.append({"choices": [{"delta": {"thinking": {"text": final_thinking}}}]})
        return final_chunks

    def _finalize_native_tool_calls_parser(
        self,
        parser: Optional[NativeToolCallsStreamParser],
    ) -> List[Dict]:
        if parser is None:
            return []

        final_chunks: List[Dict] = []
        final_content, final_tool_calls = parser.finalize()
        if final_content:
            final_chunks.append({"choices": [{"delta": {"content": final_content}}]})
        if final_tool_calls:
            final_chunks.append({"choices": [{"delta": {"tool_calls": final_tool_calls}}]})
        return final_chunks

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
        if not self.validate_config():
            yield self._error_event("Invalid provider configuration")
            return

        client = self._ensure_client()

        # Convert messages (handles tool_results -> role: "tool" conversion)
        converted_messages = self._convert_messages(messages)

        request_kwargs = self._prepare_request_kwargs(
            converted_messages,
            model,
            temperature,
            tools,
            tool_choice,
            max_tokens,
            provider_preference,
            thinking_config,
            thinking_format,
        )

        # Check if prefill has unclosed <thinking> tag - parser should start inside thinking block
        # Always parse <thinking> tags from text content to prevent leakage into regular content
        prefill_has_thinking = (
            has_unclosed_thinking_tag(converted_messages) if thinking_mode == "custom" else False
        )
        parser = ThinkingStreamParser(inside_thinking=prefill_has_thinking)
        native_tc_parser = NativeToolCallsStreamParser() if native_tool_call else None
        last_finish_reason = None
        captured_usage: Optional[Dict] = None

        def _update_meta_from_chunk(chunk_dict: Dict) -> None:
            nonlocal captured_usage, last_finish_reason
            if "usage" in chunk_dict and chunk_dict["usage"]:
                captured_usage = chunk_dict["usage"]
            for choice in chunk_dict.get("choices", []):
                if choice.get("finish_reason"):
                    last_finish_reason = choice.get("finish_reason")

        def _collect_events_from_chunk(chunk_dict: Dict) -> tuple[List[ProviderEvent], bool]:
            nonlocal native_tc_parser
            events: List[ProviderEvent] = []
            should_stop = False

            chunk_dict, extra_chunks = self._mutate_chunk(chunk_dict, thinking_mode)
            chunk_dict, parser_chunks = self._apply_thinking_parser(chunk_dict, parser)
            extra_chunks.extend(parser_chunks)
            chunk_dict, fc_chunks = self._apply_native_tool_calls_parser(chunk_dict, native_tc_parser)

            if chunk_dict and self._has_meaningful_payload(chunk_dict):
                events.extend(self._chunk_to_events(chunk_dict))

            for extra in fc_chunks:
                if self._has_meaningful_payload(extra):
                    events.extend(self._chunk_to_events(extra))

            if native_tc_parser and native_tc_parser.tool_calls_completed:
                events.append(ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls")))
                return events, True

            for extra in extra_chunks:
                extra, extra_fc_chunks = self._apply_native_tool_calls_parser(extra, native_tc_parser)
                if extra and self._has_meaningful_payload(extra):
                    events.extend(self._chunk_to_events(extra))
                for extra_fc in extra_fc_chunks:
                    if self._has_meaningful_payload(extra_fc):
                        events.extend(self._chunk_to_events(extra_fc))

                if native_tc_parser and native_tc_parser.tool_calls_completed:
                    events.append(ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls")))
                    should_stop = True
                    break

            return events, should_stop

        try:
            # Chat Completions stream API does not provide a native final completion object.
            raw_stream = await client.chat.completions.create(**request_kwargs)
            try:
                async for chunk in raw_stream:
                    chunk_dict = chunk.model_dump(exclude_none=True)
                    if not isinstance(chunk_dict, dict):
                        continue

                    _update_meta_from_chunk(chunk_dict)
                    stream_events, should_stop = _collect_events_from_chunk(chunk_dict)
                    for stream_event in stream_events:
                        yield stream_event
                    if should_stop:
                        return
            finally:
                if raw_stream is not None:
                    await raw_stream.close()

        except (APIConnectionError, RateLimitError, AuthenticationError, BadRequestError, APIStatusError) as exc:
            status = getattr(exc, "status_code", None)
            yield self._error_event(str(exc), status)
            return
        except OpenAIError as exc:
            yield self._error_event(str(exc), getattr(exc, "status_code", None))
            return
        except Exception as exc:
            yield self._error_event(str(exc))
            return

        try:
            for final_chunk in self._finalize_parser(parser):
                final_chunk, final_fc_chunks = self._apply_native_tool_calls_parser(final_chunk, native_tc_parser)
                if final_chunk and self._has_meaningful_payload(final_chunk):
                    for event in self._chunk_to_events(final_chunk):
                        yield event
                for extra in final_fc_chunks:
                    if self._has_meaningful_payload(extra):
                        for event in self._chunk_to_events(extra):
                            yield event

            for final_fc_chunk in self._finalize_native_tool_calls_parser(native_tc_parser):
                if self._has_meaningful_payload(final_fc_chunk):
                    for event in self._chunk_to_events(final_fc_chunk):
                        yield event

            # Emit finish_reason if tool calls were completed
            if native_tc_parser and native_tc_parser.tool_calls_completed:
                yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))
                return
        except Exception as exc:
            yield self._error_event(str(exc))
            return

        # Check for error finish_reasons and emit error if needed
        if last_finish_reason == "content_filter":
            yield self._error_event("Content blocked by filter (content_filter)")
            return

        # Emit usage as metadata for final snapshot assembly.
        if captured_usage:
            yield ProviderEvent(
                kind="meta",
                meta=MetaPayload(
                    usage={
                        "prompt_tokens": int(captured_usage.get("prompt_tokens", 0) or 0),
                        "completion_tokens": int(captured_usage.get("completion_tokens", 0) or 0),
                        "total_tokens": int(captured_usage.get("total_tokens", 0) or 0),
                    }
                ),
            )

    async def get_models(self) -> Dict:
        client = self._ensure_client()
        try:
            models = await client.models.list()
            # Convert to dict format expected by frontend
            return {
                "data": [model.model_dump() for model in models.data]
            }
        except OpenAIError as exc:
            raise Exception(f"Error fetching models: {exc}") from exc

import json
from typing import AsyncGenerator, Dict, List, Optional, Tuple

from anthropic import AsyncAnthropic

from .base import BaseProvider
from .native_tool_calls_parser import NativeToolCallsStreamParser
from .registry import ProviderRegistry
from .thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag
from ..utils.outbound_http import merge_user_overrides, validate_outbound_base_url


@ProviderRegistry.register
class ClaudeProvider(BaseProvider):
    """Anthropic Claude provider with extended thinking support."""

    def __init__(self, config: Dict):
        super().__init__(config)
        self._client: Optional[AsyncAnthropic] = None
        raw_base_url = (config.get("base_url") or "").strip()
        allow_base_url_override = self.name.startswith("custom_")
        self._base_url = validate_outbound_base_url(raw_base_url) if (allow_base_url_override and raw_base_url) else None
        if self.validate_config():
            self._client = self._build_client()

    def _build_client(self) -> AsyncAnthropic:
        """Build Anthropic client with optional custom base_url."""
        kwargs = {"api_key": self.api_key}
        if self._base_url:
            kwargs["base_url"] = self._base_url
        return AsyncAnthropic(**kwargs)

    # ------------------------------------------------------------------ #
    # Properties
    # ------------------------------------------------------------------ #
    @property
    def name(self) -> str:
        return "claude"

    @property
    def display_name(self) -> str:
        return "Claude"

    @property
    def api_key(self) -> Optional[str]:
        return (self.config or {}).get("api_key")

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def _ensure_client(self) -> AsyncAnthropic:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    # ------------------------------------------------------------------ #
    # Utilities
    # ------------------------------------------------------------------ #
    def _format_sse(self, payload: Dict) -> bytes:
        return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode("utf-8")

    def _format_error(self, message: str, status: Optional[int] = None) -> bytes:
        data: Dict[str, object] = {"message": message}
        if status is not None:
            data["status"] = status
        return f"event: error\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode("utf-8")

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

    def _finalize_parser(self, parser: Optional[ThinkingStreamParser]) -> List[Dict]:
        if parser is None:
            return []
        final_chunks: List[Dict] = []
        final_content, final_thinking = parser.finalize()
        if final_content:
            final_chunks.append({"choices": [{"delta": {"content": final_content}}]})
        if final_thinking:
            final_chunks.append({"choices": [{"delta": {"thinking": {"text": final_thinking}}}]})
        return final_chunks

    # ------------------------------------------------------------------ #
    # Message preparation
    # ------------------------------------------------------------------ #
    def _convert_messages(self, messages: List[Dict]) -> Tuple[Optional[str], List[Dict]]:
        """Map OpenAI-style messages to Anthropic messages + system prompt.

        Handles tool_calls in assistant messages by converting to Claude's
        tool_use content block format.
        """
        system_parts: List[str] = []
        anthropic_messages: List[Dict] = []

        for msg in messages:
            role = msg.get("role")
            content = msg.get("content") or ""
            tool_calls = msg.get("tool_calls")

            if role == "system":
                system_parts.append(content)
                continue

            mapped_role = "user" if role == "user" else "assistant"

            # Handle tool_results messages (from frontend after tool call application)
            if role == "tool_results":
                tool_results = msg.get("tool_results", [])
                if tool_results:
                    content_blocks = []
                    for tr in tool_results:
                        content_blocks.append({
                            "type": "tool_result",
                            "tool_use_id": tr.get("tool_call_id", ""),
                            "content": tr.get("content", "")
                        })
                    # Claude requires tool_result in a user message
                    anthropic_messages.append({"role": "user", "content": content_blocks})
                continue

            # Handle assistant messages with tool_calls
            if role == "assistant" and tool_calls:
                content_blocks = []
                # Add text content if present
                if content:
                    content_blocks.append({"type": "text", "text": content})
                # Convert tool_calls to Claude tool_use blocks
                for tc in tool_calls:
                    tc_function = tc.get("function", {})
                    args_str = tc_function.get("arguments", "{}")
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    except json.JSONDecodeError:
                        args = {}
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tc.get("id", ""),
                        "name": tc_function.get("name", ""),
                        "input": args
                    })
                anthropic_messages.append({"role": mapped_role, "content": content_blocks})
            else:
                anthropic_messages.append({"role": mapped_role, "content": content})

        system_prompt = "\n\n".join(system_parts) if system_parts else None
        return system_prompt, anthropic_messages

    def _build_thinking_kwargs(
        self,
        thinking_mode: Optional[str],
        thinking_config: Optional[Dict],
    ) -> Tuple[Optional[Dict], Optional[Dict]]:
        """Translate neutral thinking config into Anthropic adaptive thinking shape."""
        if thinking_mode != "model":
            return None, None

        effort = "high"
        if thinking_config:
            raw_effort = thinking_config.get("effort")
            if isinstance(raw_effort, str) and raw_effort.strip():
                effort = raw_effort.strip().lower()

        # Adaptive thinking currently accepts low|medium|high|max.
        if effort not in {"low", "medium", "high", "max"}:
            raise ValueError("Claude adaptive thinking effort must be one of: low, medium, high, max")

        thinking: Dict[str, object] = {"type": "adaptive"}
        output_config: Dict[str, object] = {"effort": effort}
        return thinking, output_config

    def _additional_request_body(self) -> Dict[str, object]:
        """Additional request payload for subclasses (e.g., custom gateways)."""
        return {}

    # ------------------------------------------------------------------ #
    # Streaming
    # ------------------------------------------------------------------ #
    # Mapping from unified tool_choice to Anthropic's format
    TOOL_CHOICE_MAP = {
        "auto": {"type": "auto"},
        "required": {"type": "any"},
        "none": {"type": "none"},
    }

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
    ) -> AsyncGenerator[bytes, None]:
        if not self.validate_config():
            yield self._format_error("Claude API key is required")
            return

        client = self._ensure_client()
        system_prompt, anthropic_messages = self._convert_messages(messages)

        request: Dict[str, object] = {
            "model": model,
            "messages": anthropic_messages,
            "temperature": temperature,
            "max_tokens": max_tokens or 1024,
        }

        if system_prompt:
            request["system"] = system_prompt

        thinking_kwargs, output_config = self._build_thinking_kwargs(thinking_mode, thinking_config)
        if thinking_kwargs:
            request["thinking"] = thinking_kwargs
        if output_config:
            request["output_config"] = output_config

        if tools:
            # Anthropic native tool format (NOT OpenAI format)
            anthropic_tools = []
            for fn in tools:
                anthropic_tools.append({
                    "name": fn.get("name"),
                    "description": fn.get("description", ""),
                    "input_schema": fn.get("parameters") or {},
                })
            request["tools"] = anthropic_tools
            request["tool_choice"] = self.TOOL_CHOICE_MAP.get(tool_choice or "auto", {"type": "auto"})

        additional_body = self._additional_request_body()
        if additional_body:
            request = merge_user_overrides(request, additional_body)

        # Check if prefill has unclosed <thinking> tag - parser should start inside thinking block
        # Always parse <thinking> tags from text content to prevent leakage into regular content
        prefill_has_thinking = has_unclosed_thinking_tag(messages) if thinking_mode == "custom" else False
        parser = ThinkingStreamParser(inside_thinking=prefill_has_thinking)
        native_tc_parser = NativeToolCallsStreamParser() if native_tool_call else None

        # Track content block meta by index
        block_meta: Dict[int, Dict[str, Optional[str]]] = {}
        tool_buffers: Dict[str, str] = {}
        stop_reason: Optional[str] = None

        try:
            async with client.messages.stream(**request) as stream:
                async for event in stream:
                    etype = getattr(event, "type", None)

                    # Track stop_reason from message_stop or message_delta events
                    if etype == "message_stop":
                        msg = getattr(stream, "current_message_snapshot", None)
                        if msg:
                            stop_reason = getattr(msg, "stop_reason", None)
                        continue

                    if etype == "message_delta":
                        delta = getattr(event, "delta", None)
                        if delta:
                            sr = getattr(delta, "stop_reason", None)
                            if sr:
                                stop_reason = sr
                        continue

                    if etype == "content_block_start":
                        cb = getattr(event, "content_block", None)
                        if cb is None and hasattr(event, "model_dump"):
                            cb = event.model_dump().get("content_block")

                        if cb is None:
                            continue

                        ctype = getattr(cb, "type", None) or (cb.get("type") if isinstance(cb, dict) else None)
                        cid = getattr(cb, "id", None) or (cb.get("id") if isinstance(cb, dict) else None)
                        cname = getattr(cb, "name", None) or (cb.get("name") if isinstance(cb, dict) else None)
                        cindex = getattr(event, "index", None)
                        if cindex is None and isinstance(event, dict):
                            cindex = event.get("index")

                        if cindex is not None:
                            block_meta[cindex] = {"type": ctype, "id": cid, "name": cname}

                        if ctype == "tool_use":
                            tool_id = cid or f"tool_{cindex}"
                            tool_buffers[tool_id] = ""
                            payload = {
                                "choices": [
                                    {
                                        "delta": {
                                            "tool_calls": [
                                                {
                                                    "id": tool_id,
                                                    "type": "function",
                                                    "function": {"name": cname or "", "arguments": ""},
                                                }
                                            ]
                                        }
                                    }
                                ]
                            }
                            if self._has_meaningful_payload(payload):
                                yield self._format_sse(payload)

                        continue

                    if etype == "content_block_delta":
                        idx = getattr(event, "index", None)
                        if idx is None and isinstance(event, dict):
                            idx = event.get("index")
                        delta_obj = getattr(event, "delta", None)
                        if delta_obj is None and hasattr(event, "model_dump"):
                            delta_obj = event.model_dump().get("delta")
                        if delta_obj is None and isinstance(event, dict):
                            delta_obj = event.get("delta")

                        meta = block_meta.get(idx, {})
                        block_type = meta.get("type")

                        delta_type = None
                        delta_text = None
                        delta_thinking = None
                        delta_signature = None
                        delta_partial_json = None
                        if delta_obj is not None:
                            delta_type = getattr(delta_obj, "type", None)
                            delta_text = getattr(delta_obj, "text", None)
                            delta_thinking = getattr(delta_obj, "thinking", None)
                            delta_signature = getattr(delta_obj, "signature", None)
                            delta_partial_json = getattr(delta_obj, "partial_json", None)
                            if isinstance(delta_obj, dict):
                                delta_type = delta_type or delta_obj.get("type")
                                delta_text = delta_text or delta_obj.get("text")
                                delta_thinking = delta_thinking or delta_obj.get("thinking")
                                delta_signature = delta_signature or delta_obj.get("signature")
                                delta_partial_json = delta_partial_json or delta_obj.get("partial_json")

                        extra_chunks: List[Dict] = []

                        if block_type == "thinking":
                            if delta_type == "thinking_delta" and delta_thinking:
                                chunk = {"choices": [{"delta": {"thinking": {"text": delta_thinking}}}]}
                                if self._has_meaningful_payload(chunk):
                                    yield self._format_sse(chunk)
                            elif delta_type == "signature_delta" and delta_signature:
                                chunk = {"choices": [{"delta": {"thinking": {"signature": delta_signature}}}]}
                                if self._has_meaningful_payload(chunk):
                                    yield self._format_sse(chunk)
                            elif delta_text:
                                # Fallback for gateways that emit plain text deltas on thinking blocks.
                                chunk = {"choices": [{"delta": {"thinking": {"text": delta_text}}}]}
                                if self._has_meaningful_payload(chunk):
                                    yield self._format_sse(chunk)
                            continue

                        if block_type == "tool_use":
                            tool_id = meta.get("id") or f"tool_{idx}"
                            delta_fragment = (
                                delta_partial_json
                                if isinstance(delta_partial_json, str)
                                else (delta_text if isinstance(delta_text, str) else "")
                            )
                            tool_buffers[tool_id] = tool_buffers.get(tool_id, "") + delta_fragment

                            payload = {
                                "choices": [
                                    {
                                        "delta": {
                                            "tool_calls": [
                                                {
                                                    "id": tool_id,
                                                    "type": "function",
                                                    "function": {
                                                        "name": meta.get("name") or "",
                                                        "arguments": delta_fragment,
                                                    },
                                                }
                                            ]
                                        }
                                    }
                                ]
                            }
                            if delta_fragment and self._has_meaningful_payload(payload):
                                yield self._format_sse(payload)
                            continue

                        text_for_content = delta_text if isinstance(delta_text, str) else None
                        if text_for_content:
                            text_to_emit = text_for_content
                            if parser:
                                clean, thinking_block = parser.process_chunk(text_for_content)
                                text_to_emit = clean
                                if thinking_block:
                                    extra_chunks.append(
                                        {"choices": [{"delta": {"thinking": {"text": thinking_block}}}]}
                                    )

                            if native_tc_parser and text_to_emit:
                                clean_content, tool_calls = native_tc_parser.process_chunk(text_to_emit)
                                text_to_emit = clean_content
                                if tool_calls:
                                    extra_chunks.append(
                                        {"choices": [{"delta": {"tool_calls": tool_calls}}]}
                                    )

                            if text_to_emit:
                                payload = {"choices": [{"delta": {"content": text_to_emit}}]}
                                if self._has_meaningful_payload(payload):
                                    yield self._format_sse(payload)

                            for extra in extra_chunks:
                                if self._has_meaningful_payload(extra):
                                    yield self._format_sse(extra)

                            # Stop streaming after tool_calls block completes
                            if native_tc_parser and native_tc_parser.tool_calls_completed:
                                yield self._format_sse({"choices": [{"finish_reason": "tool_calls"}]})
                                return

                        continue

                # Flush remaining buffered thinking/content
                for final_chunk in self._finalize_parser(parser):
                    delta = (final_chunk.get("choices") or [{}])[0].get("delta") or {}
                    content = delta.get("content")
                    if native_tc_parser and isinstance(content, str) and content:
                        clean_content, tool_calls = native_tc_parser.process_chunk(content)
                        if clean_content:
                            payload = {"choices": [{"delta": {"content": clean_content}}]}
                            if self._has_meaningful_payload(payload):
                                yield self._format_sse(payload)
                        if tool_calls:
                            payload = {"choices": [{"delta": {"tool_calls": tool_calls}}]}
                            if self._has_meaningful_payload(payload):
                                yield self._format_sse(payload)
                    else:
                        yield self._format_sse(final_chunk)

                if native_tc_parser:
                    tail_text, tail_tool_calls = native_tc_parser.finalize()
                    if tail_text:
                        payload = {"choices": [{"delta": {"content": tail_text}}]}
                        if self._has_meaningful_payload(payload):
                            yield self._format_sse(payload)
                    if tail_tool_calls:
                        payload = {"choices": [{"delta": {"tool_calls": tail_tool_calls}}]}
                        if self._has_meaningful_payload(payload):
                            yield self._format_sse(payload)
                    # Emit finish_reason if tool calls were completed
                    if native_tc_parser.tool_calls_completed:
                        yield self._format_sse({"choices": [{"finish_reason": "tool_calls"}]})
                        return

                # Check for error stop_reasons and emit error if needed
                if stop_reason == "refusal":
                    yield self._format_error("Claude refused to generate due to safety concerns (refusal)")
                    return  # Don't yield [DONE] after error

                # Emit usage information before [DONE]
                msg = getattr(stream, "current_message_snapshot", None)
                if msg and hasattr(msg, "usage") and msg.usage:
                    usage = msg.usage
                    input_tokens = getattr(usage, "input_tokens", 0) or 0
                    output_tokens = getattr(usage, "output_tokens", 0) or 0
                    usage_payload = {
                        "usage": {
                            "prompt_tokens": input_tokens,
                            "completion_tokens": output_tokens,
                            "total_tokens": input_tokens + output_tokens,
                        }
                    }
                    yield self._format_sse(usage_payload)

                yield b"data: [DONE]\n\n"

        except Exception as exc:  # Broad catch to stream error via SSE
            yield self._format_error(str(exc), getattr(exc, "status_code", None))
            yield b"data: [DONE]\n\n"

    async def get_models(self) -> Dict:
        """
        Fetch available Claude models from Anthropic API.
        """
        if not self.validate_config():
            raise Exception("Claude API key is required to fetch models")

        client = self._ensure_client()
        response = await client.models.list()

        models = []
        for model in response.data:
            models.append({
                "id": model.id,
                "display_name": model.display_name,
                "created_at": model.created_at,
            })
        return {"data": models}

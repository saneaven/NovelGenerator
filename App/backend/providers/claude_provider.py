import json
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from anthropic import AsyncAnthropic

from .base import BaseProvider
from .client_timeouts import get_llm_stream_timeout
from .contracts import DeltaPayload, MetaPayload, ProviderErrorPayload, ProviderEvent
from .final_mappers import map_claude_message_to_snapshot
from .multimodal import build_claude_content, get_canonical_content_parts
from .native_tool_calls_parser import NativeToolCallsStreamParser
from .registry import ProviderRegistry
from .thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag
from ..utils.outbound_http import merge_user_overrides, validate_outbound_base_url

logger = logging.getLogger(__name__)


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
        kwargs = {
            "api_key": self.api_key,
            "timeout": get_llm_stream_timeout(),
        }
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

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        blocks: list[dict[str, Any]] = []
        for block in self._snapshot_reasoning_details(final_snapshot):
            if not isinstance(block, dict):
                continue
            if block.get("type") != "thinking":
                continue
            signature = block.get("signature")
            thinking_text = block.get("thinking") or block.get("text")
            if isinstance(signature, str) and signature:
                blocks.append(block)
                continue
            if isinstance(thinking_text, str) and thinking_text:
                blocks.append(block)

        reasoning_text = self._reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not blocks and not reasoning_text:
            return None

        data: dict[str, Any] = {"blocks": blocks}
        meta: dict[str, Any] = {"provider": "claude"}
        if reasoning_text:
            data["reasoning_text"] = reasoning_text
            meta["thinking_display"] = "reasoning_text"

        return {
            "type": "claude",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        return None

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return "reasoning_text"

    @staticmethod
    def _error_event(message: str, status: Optional[int] = None) -> ProviderEvent:
        return ProviderEvent(
            kind="error",
            error=ProviderErrorPayload(message=message, status=status),
        )

    @staticmethod
    def _normalize_finish_reason(stop_reason: Optional[str]) -> Optional[str]:
        if not stop_reason:
            return None
        normalized = str(stop_reason)
        if normalized in {"tool_use", "tool_calls"}:
            return "tool_calls"
        if normalized in {"end_turn", "stop_sequence"}:
            return "stop"
        return normalized

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
            role = msg.get("role", "user")
            canonical_parts = get_canonical_content_parts(msg)
            text = self._extract_text_content(msg)
            tool_calls = msg.get("tool_calls")
            reasoning_detail = msg.get("reasoning_detail") if isinstance(msg.get("reasoning_detail"), dict) else None

            if role == "system":
                if text:
                    system_parts.append(text)
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
            reasoning_blocks: List[Dict[str, Any]] = []
            if role == "assistant" and isinstance(reasoning_detail, dict):
                reasoning_data = reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}
                blocks = reasoning_data.get("blocks")
                if isinstance(blocks, list):
                    for block in blocks:
                        if (
                            isinstance(block, dict)
                            and block.get("type") == "thinking"
                            and isinstance(block.get("thinking") or block.get("text"), str)
                        ):
                            reasoning_blocks.append(block)
                details = reasoning_data.get("details")
                if isinstance(details, list):
                    for detail in details:
                        if isinstance(detail, dict) and detail.get("type") == "thinking":
                            reasoning_blocks.append(detail)

            if role == "assistant" and tool_calls:
                content_blocks = []
                if reasoning_blocks:
                    content_blocks.extend(reasoning_blocks)
                content_blocks.extend(build_claude_content(canonical_parts))
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
                        "input": args,
                    })
                anthropic_messages.append({"role": mapped_role, "content": content_blocks})
            else:
                if role == "assistant" and reasoning_blocks:
                    content_blocks = list(reasoning_blocks)
                    content_blocks.extend(build_claude_content(canonical_parts))
                    if content_blocks:
                        anthropic_messages.append({"role": mapped_role, "content": content_blocks})
                else:
                    content_blocks = build_claude_content(canonical_parts)
                    if not content_blocks:
                        continue
                    anthropic_messages.append({"role": mapped_role, "content": content_blocks})

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
        custom_kind: Optional[str] = None,
        native_tool_call: bool = False,
        verbosity: Optional[str] = None,
    ) -> AsyncGenerator[ProviderEvent, None]:
        if not self.validate_config():
            yield self._error_event("Claude API key is required")
            return

        client = self._ensure_client()
        system_prompt, anthropic_messages = self._convert_messages(messages)

        request: Dict[str, object] = {
            "model": model,
            "messages": anthropic_messages,
            "temperature": temperature,
            "max_tokens": max_tokens or 8096,
        }

        if system_prompt:
            request["system"] = system_prompt

        thinking_kwargs, output_config = self._build_thinking_kwargs(thinking_mode, thinking_config)
        if thinking_kwargs:
            request["thinking"] = thinking_kwargs
        if output_config:
            request["output_config"] = output_config

        if tools:
            anthropic_tools = []
            for fn in tools:
                anthropic_tools.append(
                    {
                        "name": fn.get("name"),
                        "description": fn.get("description", ""),
                        "input_schema": fn.get("parameters") or {},
                    }
                )
            request["tools"] = anthropic_tools
            request["tool_choice"] = self.TOOL_CHOICE_MAP.get(tool_choice or "auto", {"type": "auto"})
            request["tool_choice"]["disable_parallel_tool_use"] = False

        additional_body = self._additional_request_body()
        if additional_body:
            request = merge_user_overrides(request, additional_body)

        yield ProviderEvent(kind="meta", raw_request=request)

        has_open_thinking = (
            has_unclosed_thinking_tag(anthropic_messages) if thinking_mode == "custom" else False
        )
        parser = ThinkingStreamParser(inside_thinking=has_open_thinking)
        native_tc_parser = NativeToolCallsStreamParser() if native_tool_call else None

        block_meta: Dict[int, Dict[str, Optional[str]]] = {}
        stop_reason: Optional[str] = None
        tool_finish_emitted = False
        stream = None

        try:
            async with client.messages.stream(**request) as stream:
                async for event in stream:
                    etype = getattr(event, "type", None)

                    if etype == "message_stop":
                        msg = getattr(stream, "current_message_snapshot", None)
                        if msg:
                            stop_reason = getattr(msg, "stop_reason", None) or stop_reason
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

                        if isinstance(cindex, int):
                            block_meta[cindex] = {"type": ctype, "id": cid, "name": cname}

                        if ctype == "tool_use":
                            tool_id = str(cid or f"tool_{cindex}")
                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(
                                    tool_call_deltas=[
                                        {
                                            "index": int(cindex) if isinstance(cindex, int) else 0,
                                            "id": tool_id,
                                            "type": "function",
                                            "function": {"name": cname or "", "arguments": ""},
                                        }
                                    ]
                                ),
                            )
                        continue

                    if etype != "content_block_delta":
                        continue

                    idx = getattr(event, "index", None)
                    if idx is None and isinstance(event, dict):
                        idx = event.get("index")
                    delta_obj = getattr(event, "delta", None)
                    if delta_obj is None and hasattr(event, "model_dump"):
                        delta_obj = event.model_dump().get("delta")
                    if delta_obj is None and isinstance(event, dict):
                        delta_obj = event.get("delta")

                    meta = block_meta.get(idx if isinstance(idx, int) else -1, {})
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

                    if block_type == "thinking":
                        thinking_text = None
                        if delta_type == "thinking_delta" and isinstance(delta_thinking, str):
                            thinking_text = delta_thinking
                        elif isinstance(delta_text, str) and delta_text:
                            thinking_text = delta_text
                        if thinking_text:
                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(thinking_delta=thinking_text),
                            )

                        thinking_detail: Dict[str, Any] = {"type": "thinking"}
                        if isinstance(thinking_text, str) and thinking_text:
                            thinking_detail["thinking"] = thinking_text
                        if isinstance(delta_signature, str) and delta_signature:
                            thinking_detail["signature"] = delta_signature
                        if len(thinking_detail) > 1:
                                yield ProviderEvent(
                                    kind="delta",
                                    delta=DeltaPayload(
                                        reasoning_detail_delta=[thinking_detail]
                                    ),
                                )
                        continue

                    if block_type == "tool_use":
                        tool_id = str(meta.get("id") or f"tool_{idx}")
                        delta_fragment = (
                            delta_partial_json
                            if isinstance(delta_partial_json, str)
                            else (delta_text if isinstance(delta_text, str) else "")
                        )
                        if delta_fragment:
                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(
                                    tool_call_deltas=[
                                        {
                                            "index": int(idx) if isinstance(idx, int) else 0,
                                            "id": tool_id,
                                            "type": "function",
                                            "function": {
                                                "name": meta.get("name") or "",
                                                "arguments": delta_fragment,
                                            },
                                        }
                                    ]
                                ),
                            )
                        continue

                    text_for_content = delta_text if isinstance(delta_text, str) else None
                    if not text_for_content:
                        continue

                    text_to_emit = text_for_content
                    thinking_extra: Optional[str] = None
                    if parser:
                        clean, thinking_block = parser.process_chunk(text_for_content)
                        text_to_emit = clean
                        thinking_extra = thinking_block

                    tool_extra = None
                    if native_tc_parser and text_to_emit:
                        clean_content, tool_calls = native_tc_parser.process_chunk(text_to_emit)
                        text_to_emit = clean_content
                        tool_extra = tool_calls

                    if text_to_emit:
                        yield ProviderEvent(
                            kind="delta",
                            delta=DeltaPayload(content_delta=text_to_emit),
                        )

                    if thinking_extra:
                        yield ProviderEvent(
                            kind="delta",
                            delta=DeltaPayload(thinking_delta=thinking_extra),
                        )

                    if tool_extra:
                        yield ProviderEvent(
                            kind="delta",
                            delta=DeltaPayload(tool_call_deltas=tool_extra),
                        )

                    if native_tc_parser and native_tc_parser.tool_calls_completed and not tool_finish_emitted:
                        tool_finish_emitted = True
                        yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))

            for final_chunk in self._finalize_parser(parser):
                delta = (final_chunk.get("choices") or [{}])[0].get("delta") or {}
                content = delta.get("content")
                thinking_obj = delta.get("thinking") if isinstance(delta.get("thinking"), dict) else {}
                thinking_text = thinking_obj.get("text") if isinstance(thinking_obj.get("text"), str) else None

                if native_tc_parser and isinstance(content, str) and content:
                    clean_content, tool_calls = native_tc_parser.process_chunk(content)
                    if clean_content:
                        yield ProviderEvent(kind="delta", delta=DeltaPayload(content_delta=clean_content))
                    if tool_calls:
                        yield ProviderEvent(kind="delta", delta=DeltaPayload(tool_call_deltas=tool_calls))
                elif isinstance(content, str) and content:
                    yield ProviderEvent(kind="delta", delta=DeltaPayload(content_delta=content))

                if thinking_text:
                    yield ProviderEvent(kind="delta", delta=DeltaPayload(thinking_delta=thinking_text))

            if native_tc_parser:
                tail_text, tail_tool_calls = native_tc_parser.finalize()
                if tail_text:
                    yield ProviderEvent(kind="delta", delta=DeltaPayload(content_delta=tail_text))
                if tail_tool_calls:
                    yield ProviderEvent(kind="delta", delta=DeltaPayload(tool_call_deltas=tail_tool_calls))
                if native_tc_parser.tool_calls_completed and not tool_finish_emitted:
                    tool_finish_emitted = True
                    yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))

            if stop_reason == "refusal":
                yield self._error_event("Claude refused to generate due to safety concerns (refusal)")
                return

            final_message: Optional[Any] = None
            if stream is not None:
                try:
                    final_message = await stream.get_final_message()
                except Exception:
                    final_message = None

            if final_message is not None:
                if not stop_reason:
                    stop_reason = getattr(final_message, "stop_reason", None) or stop_reason

                try:
                    native_snapshot = map_claude_message_to_snapshot(
                        final_message,
                        provider=self.name,
                        model=model,
                    )
                    yield ProviderEvent(kind="final_native", final_native=native_snapshot)
                except Exception as exc:
                    logger.warning(
                        "Native final mapping failed in %s provider (model=%s); falling back to snapshot assembler: %s",
                        self.name,
                        model,
                        exc,
                        exc_info=True,
                    )

                usage_obj = getattr(final_message, "usage", None)
                usage_payload = None
                if usage_obj:
                    input_tokens = int(getattr(usage_obj, "input_tokens", 0) or 0)
                    output_tokens = int(getattr(usage_obj, "output_tokens", 0) or 0)
                    usage_payload = {
                        "prompt_tokens": input_tokens,
                        "completion_tokens": output_tokens,
                        "total_tokens": input_tokens + output_tokens,
                    }

                finish_reason = self._normalize_finish_reason(stop_reason)
                if usage_payload is not None or finish_reason is not None:
                    if tool_finish_emitted and finish_reason == "tool_calls":
                        finish_reason = None
                    yield ProviderEvent(
                        kind="meta",
                        meta=MetaPayload(
                            usage=usage_payload,
                            finish_reason=finish_reason,
                        ),
                    )

        except Exception as exc:  # pragma: no cover - surfaced via provider error event
            status = (
                getattr(exc, "status_code", None)
                or getattr(exc, "status", None)
                or getattr(exc, "code", None)
            )
            yield self._error_event(str(exc), status if isinstance(status, int) else None)
            return

    async def get_models(self) -> Dict:
        """Fetch available Claude models from Anthropic API."""
        if not self.validate_config():
            raise Exception("Claude API key is required to fetch models")

        client = self._ensure_client()
        response = await client.models.list()

        models = []
        for model in response.data:
            models.append(
                {
                    "id": model.id,
                    "display_name": model.display_name,
                    "created_at": model.created_at,
                }
            )
        return {"data": models}

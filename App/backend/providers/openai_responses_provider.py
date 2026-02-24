"""
OpenAI Responses API Provider

This provider uses OpenAI's newer Responses API instead of the Chat Completions API.
The Responses API provides better performance with reasoning models (GPT-5, o1, o3, etc.)
and natively supports the `reasoning: {effort: ...}` parameter format.

Benefits:
- 3% better performance with reasoning models
- 40-80% better cache utilization (cost savings)
- Reasoning state preserved across turns
- Native reasoning parameter support
"""

import logging
import re
from typing import AsyncGenerator, Dict, List, Optional

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
from .final_mappers import map_openai_response_to_snapshot
from .native_tool_calls_parser import NativeToolCallsStreamParser
from .registry import ProviderRegistry

# Text/chat model patterns: gpt-* or o{number}*
TEXT_MODEL_REGEX = re.compile(r'^(gpt-|o\d)')
logger = logging.getLogger(__name__)


@ProviderRegistry.register
class OpenAIResponsesProvider(BaseProvider):
    """OpenAI Responses API provider for GPT-5 and reasoning models."""

    def __init__(self, config: Dict):
        super().__init__(config)
        self._client: Optional[AsyncOpenAI] = None
        if self.validate_config():
            self._client = self._build_client()

    @property
    def name(self) -> str:
        return "openai"

    @property
    def display_name(self) -> str:
        return "OpenAI"

    def validate_config(self) -> bool:
        return bool(self.config.get("api_key"))

    @property
    def api_key(self) -> Optional[str]:
        return self.config.get("api_key")

    @property
    def base_url(self) -> str:
        return "https://api.openai.com/v1"

    def _build_client(self) -> AsyncOpenAI:
        return AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )

    def _ensure_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    def _convert_messages(self, messages: List[Dict]) -> List[Dict]:
        """
        Convert canonical messages to Responses API input format.

        Canonical format:
            {"role": "user", "content_parts": [{"type": "content", "text": "Hello"}]}

        Responses API format:
            {"role": "user", "content": [{"type": "input_text", "text": "Hello"}]}

        Also handles tool_calls in assistant messages by converting to
        Responses API function_call format.
        """
        result = []
        for msg in messages:
            role = msg.get("role", "user")
            text_content = self._extract_text_content(msg)
            tool_calls = msg.get("tool_calls")
            reasoning_detail = msg.get("reasoning_detail") if isinstance(msg.get("reasoning_detail"), dict) else None

            # Map roles (Chat Completions -> Responses)
            # system -> developer in Responses API
            if role == "system":
                role = "developer"

            # Handle tool_results messages
            if role == "tool_results":
                tool_results = msg.get("tool_results", [])
                for tr in tool_results:
                    result.append({
                        "type": "function_call_output",
                        "call_id": tr.get("tool_call_id", ""),
                        "output": tr.get("content", "")
                    })
                continue

            # Helpers: collect reasoning items and output message ID
            def _reasoning_data() -> Dict:
                if not isinstance(reasoning_detail, dict):
                    return {}
                return reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}

            def _reasoning_items() -> List[Dict]:
                items = _reasoning_data().get("items")
                if not isinstance(items, list):
                    return []
                return [item for item in items if isinstance(item, dict)]

            def _apply_output_id(msg_dict: Dict, ri: List[Dict]) -> None:
                """Mark assistant message as a proper output item when reasoning items are present."""
                if not ri:
                    return
                msg_dict["type"] = "message"
                msg_dict["status"] = "completed"
                output_msg_id = _reasoning_data().get("output_msg_id")
                if isinstance(output_msg_id, str) and output_msg_id:
                    msg_dict["id"] = output_msg_id

            # Handle assistant messages with tool_calls
            if role == "assistant" and tool_calls:
                # Reasoning items must precede the output they produced
                ri = _reasoning_items()
                for item in ri:
                    result.append(item)
                # Add message only if there's text content
                if text_content:
                    content_items = [{"type": "output_text", "text": text_content}]
                    msg_dict: Dict = {"role": role, "content": content_items}
                    _apply_output_id(msg_dict, ri)
                    result.append(msg_dict)
                # Function calls are top-level input items in the Responses API
                fc_item_ids = _reasoning_data().get("function_call_item_ids", {})
                for tc in tool_calls:
                    tc_function = tc.get("function", {})
                    call_id = tc.get("id", "")
                    fc_item: Dict = {
                        "type": "function_call",
                        "call_id": call_id,
                        "name": tc_function.get("name", ""),
                        "arguments": tc_function.get("arguments", "{}")
                    }
                    original_id = fc_item_ids.get(call_id)
                    if original_id:
                        fc_item["id"] = original_id
                        fc_item["status"] = "completed"
                    result.append(fc_item)
                continue

            # Skip empty assistant messages — reasoning items without a
            # following output item would cause a 400 error from the API.
            if not text_content:
                continue

            # Convert text content to Responses content array format.
            item_type = "output_text" if role == "assistant" else "input_text"
            content_items = [{"type": item_type, "text": text_content}]

            # Reasoning items must precede the output they produced
            ri = _reasoning_items() if role == "assistant" else []
            for item in ri:
                result.append(item)
            msg_dict: Dict = {"role": role, "content": content_items}
            _apply_output_id(msg_dict, ri)
            result.append(msg_dict)

        return result

    @staticmethod
    def _error_event(message: str, status: Optional[int] = None) -> ProviderEvent:
        return ProviderEvent(
            kind="error",
            error=ProviderErrorPayload(message=message, status=status),
        )

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
        """
        Stream chat using OpenAI Responses API.

        Converts Responses API events to Chat Completions SSE format for
        frontend compatibility.
        """
        if not self.validate_config():
            yield self._error_event("Invalid provider configuration")
            return

        client = self._ensure_client()

        # Convert messages to Responses API format
        input_items = self._convert_messages(messages)

        # Build request
        request: Dict = {
            "model": model,
            "input": input_items,
            "stream": True,
        }

        # Add reasoning configuration (Responses API uses nested format)
        if thinking_config:
            effort = thinking_config.get("effort", "medium") or "medium"
            request["reasoning"] = {
                "effort": effort,
                "summary": "auto",  # Enable reasoning summary streaming
            }
            # Request encrypted reasoning content so items can be passed back
            # in subsequent turns for reasoning continuity.
            request["include"] = ["reasoning.encrypted_content"]

        # Add output verbosity (GPT-5: text.verbosity in Responses API)
        if verbosity:
            request["text"] = {"verbosity": verbosity}

        # Add max tokens (Responses API uses max_output_tokens)
        if max_tokens is not None:
            request["max_output_tokens"] = max_tokens

        # Add tools if provided
        # Responses API uses flat tool format: {type, name, description, parameters}
        # Chat Completions uses nested: {type, function: {name, description, parameters}}
        if tools:
            request["tools"] = [
                {
                    "type": "function",
                    "name": fn["name"],  # Required - let it error if missing
                    "description": fn.get("description"),
                    "parameters": fn.get("parameters"),
                }
                for fn in tools
            ]
            if tool_choice:
                request["tool_choice"] = tool_choice

        yield ProviderEvent(kind="meta", raw_request=request)

        # Track state for SSE conversion
        captured_usage: Optional[Dict] = None
        stream = None
        native_tc_parser = NativeToolCallsStreamParser() if native_tool_call else None
        tool_call_indices: Dict[str, int] = {}
        native_response = None
        tool_finish_emitted = False
        captured_reasoning_tokens: Optional[int] = None

        try:
            stream = await client.responses.create(**request)

            async for event in stream:
                event_type = getattr(event, "type", None)

                # Handle text delta events
                if event_type == "response.output_text.delta":
                    delta_text = getattr(event, "delta", "")
                    if delta_text:
                        text_to_emit = delta_text
                        tool_calls = None
                        if native_tc_parser:
                            text_to_emit, tool_calls = native_tc_parser.process_chunk(delta_text)

                        if text_to_emit:
                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(content_delta=text_to_emit),
                            )

                        if tool_calls:
                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(tool_call_deltas=tool_calls),
                            )

                        # Tool block completed (native_tool_call parsing mode).
                        if native_tc_parser and native_tc_parser.tool_calls_completed:
                            if not tool_finish_emitted:
                                tool_finish_emitted = True
                                yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))

                # Handle reasoning/thinking text delta
                elif event_type == "response.reasoning_text.delta":
                    delta_text = getattr(event, "delta", "")
                    if delta_text:
                        yield ProviderEvent(
                            kind="delta",
                            delta=DeltaPayload(thinking_delta=delta_text),
                        )

                # Handle reasoning summary text delta (like Google AI)
                elif event_type == "response.reasoning_summary_text.delta":
                    delta_text = getattr(event, "delta", "")
                    if delta_text:
                        yield ProviderEvent(
                            kind="delta",
                            delta=DeltaPayload(thinking_delta=delta_text),
                        )

                # Handle tool call arguments delta (OpenAI Responses API event)
                elif event_type == "response.function_call_arguments.delta":
                    delta_args = getattr(event, "delta", "")
                    call_id = getattr(event, "call_id", "")
                    name = getattr(event, "name", "")
                    if delta_args:
                        call_key = call_id or f"tool-call-{len(tool_call_indices)}"
                        if call_key not in tool_call_indices:
                            tool_call_indices[call_key] = len(tool_call_indices)
                        tool_index = tool_call_indices[call_key]
                        yield ProviderEvent(
                            kind="delta",
                            delta=DeltaPayload(
                                tool_call_deltas=[
                                    {
                                        "index": tool_index,
                                        "id": call_id or call_key,
                                        "type": "function",
                                        "function": {
                                            "name": name,
                                            "arguments": delta_args,
                                        },
                                    }
                                ]
                            ),
                        )

                # Handle response completion
                elif event_type == "response.completed":
                    # Flush any buffered tool_calls content before native final mapping.
                    if native_tc_parser:
                        tail_text, tail_tool_calls = native_tc_parser.finalize()
                        if tail_text:
                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(content_delta=tail_text),
                            )
                        if tail_tool_calls:
                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(tool_call_deltas=tail_tool_calls),
                            )
                        if native_tc_parser.tool_calls_completed:
                            if not tool_finish_emitted:
                                tool_finish_emitted = True
                                yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))
                        native_tc_parser = None

                    response_obj = getattr(event, "response", None)
                    if response_obj:
                        native_response = response_obj
                        usage = getattr(response_obj, "usage", None)
                        if usage:
                            output_tokens_details = getattr(usage, "output_tokens_details", None)
                            if output_tokens_details is not None:
                                rt = getattr(output_tokens_details, "reasoning_tokens", None)
                                if isinstance(rt, (int, float)):
                                    captured_reasoning_tokens = int(rt)
                            captured_usage = {
                                "prompt_tokens": getattr(usage, "input_tokens", 0),
                                "completion_tokens": getattr(usage, "output_tokens", 0),
                                "total_tokens": (
                                    getattr(usage, "input_tokens", 0) +
                                    getattr(usage, "output_tokens", 0)
                                )
                            }
                    yield ProviderEvent(
                        kind="meta",
                        meta=MetaPayload(finish_reason="stop", reasoning_tokens=captured_reasoning_tokens),
                    )

                # Handle errors in stream
                elif event_type == "error":
                    error_msg = getattr(event, "message", "Unknown error")
                    error_code = getattr(event, "code", None)
                    yield self._error_event(error_msg, error_code)
                    return

        except (APIConnectionError, RateLimitError, AuthenticationError, BadRequestError, APIStatusError) as exc:
            logger.error("OpenAI Responses API error (model=%s): %s", model, exc, exc_info=True)
            status = getattr(exc, "status_code", None)
            yield self._error_event(str(exc), status)
            return
        except OpenAIError as exc:
            logger.error("OpenAI SDK error (model=%s): %s", model, exc, exc_info=True)
            yield self._error_event(str(exc), getattr(exc, "status_code", None))
            return
        except Exception as exc:
            logger.error("Unexpected error in OpenAI Responses stream (model=%s): %s", model, exc, exc_info=True)
            yield self._error_event(str(exc))
            return
        finally:
            if stream is not None and hasattr(stream, "close"):
                await stream.close()

        if native_tc_parser:
            tail_text, tail_tool_calls = native_tc_parser.finalize()
            if tail_text:
                yield ProviderEvent(
                    kind="delta",
                    delta=DeltaPayload(content_delta=tail_text),
                )
            if tail_tool_calls:
                yield ProviderEvent(
                    kind="delta",
                    delta=DeltaPayload(tool_call_deltas=tail_tool_calls),
                )
            if native_tc_parser.tool_calls_completed:
                if not tool_finish_emitted:
                    tool_finish_emitted = True
                    yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))

        if native_response is not None:
            try:
                native_snapshot = map_openai_response_to_snapshot(
                    native_response,
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

        # Emit usage metadata (used to patch missing snapshot fields).
        if captured_usage:
            yield ProviderEvent(kind="meta", meta=MetaPayload(usage=captured_usage, reasoning_tokens=captured_reasoning_tokens))

    async def get_models(self) -> Dict:
        """Fetch available OpenAI models, filtered to text/chat models only."""
        client = self._ensure_client()
        try:
            models = await client.models.list()

            # Filter to text/chat models only (gpt-* or o{number}*)
            text_models = [
                model.model_dump()
                for model in models.data
                if TEXT_MODEL_REGEX.match(model.id or "")
            ]

            return {"data": text_models}
        except OpenAIError as exc:
            raise Exception(f"Error fetching models: {exc}") from exc

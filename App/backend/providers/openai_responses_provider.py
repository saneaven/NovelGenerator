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

import json
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
from .registry import ProviderRegistry

# Text/chat model patterns: gpt-* or o{number}*
TEXT_MODEL_REGEX = re.compile(r'^(gpt-|o\d)')


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

    def _convert_messages_to_input(self, messages: List[Dict]) -> List[Dict]:
        """
        Convert Chat Completions message format to Responses API input format.

        Chat Completions format:
            {"role": "user", "content": "Hello"}

        Responses API format:
            {"role": "user", "content": [{"type": "input_text", "text": "Hello"}]}
        """
        result = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            # Map roles (Chat Completions -> Responses)
            # system -> developer in Responses API
            if role == "system":
                role = "developer"

            # Convert content to array format
            if isinstance(content, str):
                content_items = [{"type": "input_text", "text": content}]
            elif isinstance(content, list):
                # Already structured content (e.g., multimodal)
                content_items = []
                for item in content:
                    if isinstance(item, str):
                        content_items.append({"type": "input_text", "text": item})
                    elif isinstance(item, dict):
                        # Handle image_url and other types
                        if item.get("type") == "text":
                            content_items.append({
                                "type": "input_text",
                                "text": item.get("text", "")
                            })
                        elif item.get("type") == "image_url":
                            content_items.append({
                                "type": "input_image",
                                "image_url": item.get("image_url", {}).get("url", "")
                            })
                        else:
                            # Pass through as-is for other types
                            content_items.append(item)
            else:
                content_items = [{"type": "input_text", "text": str(content)}]

            result.append({"role": role, "content": content_items})

        return result

    def _format_sse(self, payload: Dict) -> bytes:
        """Format payload as SSE data frame."""
        return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode("utf-8")

    def _format_error(self, message: str, status: Optional[int] = None) -> bytes:
        """Format error as SSE error event."""
        data: Dict[str, object] = {"message": message}
        if status is not None:
            data["status"] = status
        return f"event: error\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode("utf-8")

    async def stream_chat(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        functions: Optional[List[Dict]] = None,
        tool_choice: Optional[str] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None,
        thinking_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None,
        retry_config: Optional[Dict] = None,
    ) -> AsyncGenerator[bytes, None]:
        """
        Stream chat using OpenAI Responses API.

        Converts Responses API events to Chat Completions SSE format for
        frontend compatibility.
        """
        if not self.validate_config():
            yield self._format_error("Invalid provider configuration")
            return

        client = self._ensure_client()

        # Convert messages to Responses API format
        input_items = self._convert_messages_to_input(messages)

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

            # Add verbosity if specified
            if thinking_config.get("verbosity"):
                request["reasoning"]["verbosity"] = thinking_config["verbosity"]

        # Add max tokens (Responses API uses max_output_tokens)
        if max_tokens is not None:
            request["max_output_tokens"] = max_tokens

        # Add tools/functions if provided
        # Responses API uses flat tool format: {type, name, description, parameters}
        # Chat Completions uses nested: {type, function: {name, description, parameters}}
        if functions:
            request["tools"] = [
                {
                    "type": "function",
                    "name": fn["name"],  # Required - let it error if missing
                    "description": fn.get("description"),
                    "parameters": fn.get("parameters"),
                }
                for fn in functions
            ]
            if tool_choice:
                request["tool_choice"] = tool_choice

        # Track state for SSE conversion
        captured_usage: Optional[Dict] = None
        stream = None

        try:
            stream = await client.responses.create(**request)

            async for event in stream:
                event_type = getattr(event, "type", None)

                # Handle text delta events
                if event_type == "response.output_text.delta":
                    delta_text = getattr(event, "delta", "")
                    if delta_text:
                        # Convert to Chat Completions format
                        chunk = {
                            "choices": [{
                                "index": 0,
                                "delta": {"content": delta_text},
                                "finish_reason": None
                            }]
                        }
                        yield self._format_sse(chunk)

                # Handle reasoning/thinking text delta
                elif event_type == "response.reasoning_text.delta":
                    delta_text = getattr(event, "delta", "")
                    if delta_text:
                        # Emit thinking in same format as other providers
                        chunk = {
                            "choices": [{
                                "index": 0,
                                "delta": {"thinking": {"text": delta_text}},
                                "finish_reason": None
                            }]
                        }
                        yield self._format_sse(chunk)

                # Handle reasoning summary text delta (like Google AI)
                elif event_type == "response.reasoning_summary_text.delta":
                    delta_text = getattr(event, "delta", "")
                    if delta_text:
                        # Emit summary as thinking delta
                        chunk = {
                            "choices": [{
                                "index": 0,
                                "delta": {"thinking": {"text": delta_text}},
                                "finish_reason": None
                            }]
                        }
                        yield self._format_sse(chunk)

                # Handle function call arguments delta
                elif event_type == "response.function_call_arguments.delta":
                    delta_args = getattr(event, "delta", "")
                    call_id = getattr(event, "call_id", "")
                    name = getattr(event, "name", "")
                    if delta_args:
                        chunk = {
                            "choices": [{
                                "index": 0,
                                "delta": {
                                    "tool_calls": [{
                                        "index": 0,
                                        "id": call_id,
                                        "type": "function",
                                        "function": {
                                            "name": name,
                                            "arguments": delta_args
                                        }
                                    }]
                                },
                                "finish_reason": None
                            }]
                        }
                        yield self._format_sse(chunk)

                # Handle response completion
                elif event_type == "response.completed":
                    response_obj = getattr(event, "response", None)
                    if response_obj:
                        # Extract usage information
                        usage = getattr(response_obj, "usage", None)
                        if usage:
                            captured_usage = {
                                "prompt_tokens": getattr(usage, "input_tokens", 0),
                                "completion_tokens": getattr(usage, "output_tokens", 0),
                                "total_tokens": (
                                    getattr(usage, "input_tokens", 0) +
                                    getattr(usage, "output_tokens", 0)
                                )
                            }

                    # Send finish chunk
                    finish_chunk = {
                        "choices": [{
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop"
                        }]
                    }
                    yield self._format_sse(finish_chunk)

                # Handle errors in stream
                elif event_type == "error":
                    error_msg = getattr(event, "message", "Unknown error")
                    error_code = getattr(event, "code", None)
                    yield self._format_error(error_msg, error_code)
                    yield b"data: [DONE]\n\n"
                    return

        except (APIConnectionError, RateLimitError, AuthenticationError, BadRequestError, APIStatusError) as exc:
            status = getattr(exc, "status_code", None)
            yield self._format_error(str(exc), status)
            yield b"data: [DONE]\n\n"
            return
        except OpenAIError as exc:
            yield self._format_error(str(exc), getattr(exc, "status_code", None))
            yield b"data: [DONE]\n\n"
            return
        except Exception as exc:
            yield self._format_error(str(exc))
            yield b"data: [DONE]\n\n"
            return
        finally:
            if stream is not None and hasattr(stream, "close"):
                await stream.close()

        # Emit usage information before [DONE]
        if captured_usage:
            usage_payload = {"usage": captured_usage}
            yield self._format_sse(usage_payload)

        yield b"data: [DONE]\n\n"

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

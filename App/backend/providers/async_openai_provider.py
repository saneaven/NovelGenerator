import copy
import json
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
from .thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag


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
        url = self.config.get("base_url") or "https://api.openai.com/v1"
        return url.rstrip("/")

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
        functions: Optional[List[Dict]],
        tool_choice: Optional[str],
        max_tokens: Optional[int],
        provider_preference: Optional[Dict],
        thinking_config: Optional[Dict],
    ) -> Dict[str, object]:
        is_gpt5 = self._is_gpt5_model(model)

        request: Dict[str, object] = {
            "model": model,
            "messages": messages,
            "stream": True,
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

        if functions:
            request["tools"] = [{"type": "function", "function": fn} for fn in functions]
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

    # ----- Streaming hooks ------------------------------------------------------------
    def _mutate_chunk(
        self,
        chunk: Dict,
        thinking_mode: Optional[str],
    ) -> Tuple[Optional[Dict], List[Dict]]:
        return chunk, []

    # ----- Public API -----------------------------------------------------------------
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
        if not self.validate_config():
            yield self._format_error("Invalid provider configuration")
            return

        client = self._ensure_client()
        request_kwargs = self._prepare_request_kwargs(
            messages,
            model,
            temperature,
            functions,
            tool_choice,
            max_tokens,
            provider_preference,
            thinking_config,
        )

        # Check if prefill has unclosed <thinking> tag - parser should start inside thinking block
        prefill_has_thinking = has_unclosed_thinking_tag(messages) if thinking_mode == "custom" else False
        parser = ThinkingStreamParser(inside_thinking=prefill_has_thinking) if thinking_mode == "custom" else None
        last_finish_reason = None
        stream = None

        try:
            stream = await client.chat.completions.create(**request_kwargs)
            async for chunk in stream:
                chunk_dict = chunk.model_dump(exclude_none=True)

                # Track finish_reason from choices
                for choice in chunk_dict.get("choices", []):
                    if choice.get("finish_reason"):
                        last_finish_reason = choice.get("finish_reason")

                chunk_dict, extra_chunks = self._mutate_chunk(chunk_dict, thinking_mode)

                chunk_dict, parser_chunks = self._apply_thinking_parser(chunk_dict, parser)
                extra_chunks.extend(parser_chunks)

                if chunk_dict and self._has_meaningful_payload(chunk_dict):
                    yield self._format_sse(chunk_dict)

                for extra in extra_chunks:
                    if self._has_meaningful_payload(extra):
                        yield self._format_sse(extra)

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
            if stream is not None:
                await stream.close()

        for final_chunk in self._finalize_parser(parser):
            yield self._format_sse(final_chunk)

        # Check for error finish_reasons and emit error if needed
        if last_finish_reason == "content_filter":
            yield self._format_error("Content blocked by filter (content_filter)")
            return  # Don't yield [DONE] after error

        yield b"data: [DONE]\n\n"

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

from __future__ import annotations

import json
from typing import Any, AsyncGenerator, Dict, List, Optional

from ..shared.base import BaseProvider
from ..shared.contracts import (
    DeltaPayload,
    MetaPayload,
    ProviderErrorPayload,
    ProviderEvent,
)
from ..shared.parsing.multimodal import get_canonical_content_parts
from ..shared.parsing.native_tool_calls_parser import NativeToolCallsStreamParser
from ..shared.parsing.thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag
from ..shared.parsing.tool_call_arguments import parse_tool_call_arguments
from ..shared.transport.client_timeouts import get_llm_stream_timeout
from ...services.chat_attachment_service import chat_attachment_service


OLLAMA_CLOUD_API_BASE = "https://ollama.com/api"

_THINK_EFFORTS = {"low", "medium", "high", "max"}


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _extract_model_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        models = payload.get("models")
        if isinstance(models, list):
            return [item for item in models if isinstance(item, dict)]
        data = payload.get("data")
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _project_model_item(item: dict[str, Any]) -> dict[str, Any] | None:
    model_id = item.get("model") or item.get("name") or item.get("id")
    if not isinstance(model_id, str) or not model_id.strip():
        return None
    projected = dict(item)
    projected["id"] = model_id.strip()
    return projected


async def _fetch_model_capabilities(client: Any, api_key: str, model_id: str) -> list[str] | None:
    try:
        response = await client.post(
            f"{OLLAMA_CLOUD_API_BASE}/show",
            headers=_headers(api_key),
            json={"model": model_id},
        )
    except Exception:
        return None
    if response.status_code >= 400:
        return None
    try:
        payload = response.json()
    except Exception:
        return None
    capabilities = payload.get("capabilities") if isinstance(payload, dict) else None
    return capabilities if isinstance(capabilities, list) else None


def _text_from_parts(parts: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for part in parts:
        part_type = part.get("type")
        if part_type == "content":
            text = part.get("text")
            if isinstance(text, str) and text:
                chunks.append(text)
            continue
        if part_type == "text_file":
            chunks.append(_load_text_file_part(part))
    return "".join(chunks)


def _load_text_file_part(part: dict[str, Any]) -> str:
    mime_type = str(part.get("mime_type") or "text/plain").strip()
    filename = str(part.get("filename") or "attachment").strip()
    storage_key = str(part.get("storage_key") or "").strip()
    if not storage_key:
        return ""
    data = chat_attachment_service.load_attachment_bytes(storage_key)
    text = data.decode("utf-8", errors="replace")
    return f'<attached_file name="{filename}" type="{mime_type}">\n{text}\n</attached_file>'


def _image_data_from_parts(parts: list[dict[str, Any]]) -> list[str]:
    images: list[str] = []
    for part in parts:
        if part.get("type") != "image":
            continue
        mime_type = str(part.get("mime_type") or "").strip()
        storage_key = str(part.get("storage_key") or "").strip()
        if not mime_type or not storage_key:
            continue
        data = chat_attachment_service.load_attachment_bytes(storage_key)
        data_url = chat_attachment_service.to_data_url(mime_type, data)
        images.append(data_url.split(",", 1)[1] if "," in data_url else data_url)
    return images


def _safe_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed


class OllamaCloudProvider(BaseProvider):
    """Ollama Cloud provider using the native Ollama HTTP API."""

    @property
    def name(self) -> str:
        return "ollama_cloud"

    @property
    def display_name(self) -> str:
        return "Ollama Cloud"

    @property
    def api_key(self) -> Optional[str]:
        value = self.config.get("api_key")
        return str(value) if value is not None else None

    def validate_config(self) -> bool:
        return bool(str(self.api_key or "").strip())

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        details = self._snapshot_reasoning_details(final_snapshot)
        reasoning_text = self._reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not reasoning_text:
            return None

        data: dict[str, Any] = {}
        if reasoning_text:
            data["reasoning_text"] = reasoning_text
        if details:
            data["items"] = details

        return {
            "type": "ollama_cloud",
            "meta": {
                "provider": "ollama_cloud",
                "thinking_display": "reasoning_text",
            },
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return "reasoning_text"

    def _convert_messages(self, messages: List[Dict]) -> list[dict[str, Any]]:
        converted: list[dict[str, Any]] = []
        for msg in messages:
            role = str(msg.get("role") or "user")
            if role == "tool_results":
                for result in msg.get("tool_results", []) or []:
                    if not isinstance(result, dict):
                        continue
                    tool_msg: dict[str, Any] = {
                        "role": "tool",
                        "tool_name": str(result.get("tool_name") or ""),
                        "content": str(result.get("content") or ""),
                    }
                    tool_call_id = result.get("tool_call_id")
                    if isinstance(tool_call_id, str) and tool_call_id:
                        tool_msg["tool_call_id"] = tool_call_id
                    converted.append(tool_msg)
                continue

            parts = get_canonical_content_parts(msg)
            converted_msg: dict[str, Any] = {
                "role": role,
                "content": _text_from_parts(parts),
            }
            images = _image_data_from_parts(parts)
            if images:
                converted_msg["images"] = images

            tool_calls = msg.get("tool_calls")
            if role == "assistant" and isinstance(tool_calls, list) and tool_calls:
                converted_msg["tool_calls"] = self._convert_tool_calls(tool_calls)

            reasoning_detail = msg.get("reasoning_detail")
            if role == "assistant" and isinstance(reasoning_detail, dict):
                reasoning_text = self._ollama_reasoning_text(reasoning_detail)
                if reasoning_text:
                    converted_msg["thinking"] = reasoning_text

            converted.append(converted_msg)
        return converted

    @staticmethod
    def _ollama_reasoning_text(reasoning_detail: dict[str, Any]) -> str:
        reasoning_type = str(reasoning_detail.get("type") or "").strip()
        meta = reasoning_detail.get("meta") if isinstance(reasoning_detail.get("meta"), dict) else {}
        provider = str(meta.get("provider") or "").strip()
        if reasoning_type != "ollama_cloud" and provider != "ollama_cloud":
            return ""

        data = reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}
        reasoning_text = data.get("reasoning_text")
        return reasoning_text if isinstance(reasoning_text, str) else ""

    @staticmethod
    def _convert_tool_calls(tool_calls: list[Any]) -> list[dict[str, Any]]:
        converted: list[dict[str, Any]] = []
        for index, call in enumerate(tool_calls):
            if not isinstance(call, dict):
                continue
            function = call.get("function") if isinstance(call.get("function"), dict) else {}
            name = function.get("name")
            if not isinstance(name, str) or not name:
                continue
            raw_arguments = function.get("arguments")
            _raw, arguments, _parse_error = parse_tool_call_arguments(raw_arguments)
            call_index = _safe_int(function.get("index"))
            item: dict[str, Any] = {
                "type": "function",
                "function": {
                    "index": call_index if call_index is not None else index,
                    "name": name,
                    "arguments": arguments,
                },
            }
            call_id = call.get("id")
            if isinstance(call_id, str) and call_id:
                item["id"] = call_id
            converted.append(item)
        return converted

    @staticmethod
    def _convert_tools(tools: Optional[List[Dict]]) -> list[dict[str, Any]] | None:
        if not tools:
            return None
        converted: list[dict[str, Any]] = []
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            if tool.get("type") == "function" and isinstance(tool.get("function"), dict):
                converted.append(tool)
                continue
            name = tool.get("name")
            parameters = tool.get("parameters")
            if not isinstance(name, str) or not name:
                continue
            converted.append(
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": str(tool.get("description") or ""),
                        "parameters": parameters if isinstance(parameters, dict) else {"type": "object"},
                    },
                }
            )
        return converted or None

    def _prepare_request_body(
        self,
        messages: List[Dict],
        model: str,
        temperature: float,
        tools: Optional[List[Dict]],
        max_tokens: Optional[int],
        thinking_config: Optional[Dict],
        thinking_mode: Optional[str],
        provider_settings: Optional[Dict[str, Any]],
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "messages": self._convert_messages(messages),
            "stream": True,
        }

        converted_tools = self._convert_tools(tools)
        if converted_tools:
            body["tools"] = converted_tools

        options: dict[str, Any] = {}
        if temperature is not None:
            options["temperature"] = float(temperature)
        if max_tokens is not None:
            options["num_predict"] = int(max_tokens)

        settings = provider_settings if isinstance(provider_settings, dict) else {}
        settings_options = settings.get("options") if isinstance(settings.get("options"), dict) else {}
        for key, value in settings_options.items():
            if key == "think" or value is None:
                continue
            options[key] = value
        if options:
            body["options"] = options

        if thinking_mode in {"off", "custom"}:
            body["think"] = False
        elif thinking_mode == "model":
            effort = None
            if isinstance(thinking_config, dict):
                raw_effort = thinking_config.get("effort")
                if isinstance(raw_effort, str):
                    effort = raw_effort.strip().lower()
            body["think"] = effort if effort in _THINK_EFFORTS else True

        for key in ("format", "keep_alive", "logprobs", "top_logprobs"):
            value = settings.get(key)
            if value is not None:
                body[key] = value

        custom_fields = settings.get("custom_fields")
        if isinstance(custom_fields, dict):
            body.update(custom_fields)

        return body

    @staticmethod
    def _usage_from_chunk(chunk: dict[str, Any]) -> dict[str, int] | None:
        prompt_tokens = _safe_int(chunk.get("prompt_eval_count"))
        completion_tokens = _safe_int(chunk.get("eval_count"))
        if prompt_tokens is None and completion_tokens is None:
            return None
        prompt = prompt_tokens or 0
        completion = completion_tokens or 0
        return {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
        }

    @staticmethod
    def _tool_call_delta_from_ollama(call: dict[str, Any], index: int) -> dict[str, Any] | None:
        function = call.get("function") if isinstance(call.get("function"), dict) else {}
        name = function.get("name")
        if not isinstance(name, str) or not name:
            return None
        arguments = function.get("arguments")
        if isinstance(arguments, str):
            raw_arguments = arguments
        else:
            raw_arguments = json.dumps(arguments if isinstance(arguments, dict) else {}, ensure_ascii=False)
        call_index = _safe_int(function.get("index"))
        delta: dict[str, Any] = {
            "index": call_index if call_index is not None else index,
            "type": "function",
            "function": {
                "name": name,
                "arguments": raw_arguments,
            },
        }
        call_id = call.get("id")
        if isinstance(call_id, str) and call_id:
            delta["id"] = call_id
        return delta

    @classmethod
    def _events_from_chunk(
        cls,
        chunk: dict[str, Any],
        *,
        thinking_parser: ThinkingStreamParser | None = None,
        native_tool_call_parser: NativeToolCallsStreamParser | None = None,
    ) -> list[ProviderEvent]:
        events: list[ProviderEvent] = []
        message = chunk.get("message") if isinstance(chunk.get("message"), dict) else {}

        content_delta = message.get("content") if isinstance(message.get("content"), str) else None
        thinking_delta = message.get("thinking") if isinstance(message.get("thinking"), str) else None

        if content_delta and thinking_parser is not None:
            clean_content, parsed_thinking = thinking_parser.process_chunk(content_delta)
            content_delta = clean_content or None
            if parsed_thinking:
                thinking_delta = f"{thinking_delta or ''}{parsed_thinking}"

        tool_call_deltas: list[dict[str, Any]] = []
        if content_delta and native_tool_call_parser is not None:
            clean_content, parsed_tool_calls = native_tool_call_parser.process_chunk(content_delta)
            content_delta = clean_content or None
            tool_call_deltas.extend(parsed_tool_calls)

        raw_tool_calls = message.get("tool_calls")
        if isinstance(raw_tool_calls, list):
            for index, call in enumerate(raw_tool_calls):
                if not isinstance(call, dict):
                    continue
                delta = cls._tool_call_delta_from_ollama(call, index)
                if delta is not None:
                    tool_call_deltas.append(delta)

        if content_delta or thinking_delta or tool_call_deltas:
            events.append(
                ProviderEvent(
                    kind="delta",
                    delta=DeltaPayload(
                        content_delta=content_delta,
                        thinking_delta=thinking_delta,
                        tool_call_deltas=tool_call_deltas,
                    ),
                )
            )
        return events

    @classmethod
    def _finalize_stream_parsers(
        cls,
        thinking_parser: ThinkingStreamParser | None,
        native_tool_call_parser: NativeToolCallsStreamParser | None,
    ) -> list[ProviderEvent]:
        events: list[ProviderEvent] = []

        if thinking_parser is not None:
            final_content, final_thinking = thinking_parser.finalize()
            if final_content:
                events.extend(
                    cls._events_from_chunk(
                        {"message": {"content": final_content}},
                        native_tool_call_parser=native_tool_call_parser,
                    )
                )
            if final_thinking:
                events.append(
                    ProviderEvent(
                        kind="delta",
                        delta=DeltaPayload(thinking_delta=final_thinking),
                    )
                )

        if native_tool_call_parser is not None:
            final_content, final_tool_calls = native_tool_call_parser.finalize()
            if final_content or final_tool_calls:
                events.append(
                    ProviderEvent(
                        kind="delta",
                        delta=DeltaPayload(
                            content_delta=final_content or None,
                            tool_call_deltas=final_tool_calls,
                        ),
                    )
                )

        return events

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
        provider_settings: Optional[Dict[str, Any]] = None,
        cache_plan: Any = None,
    ) -> AsyncGenerator[ProviderEvent, None]:
        del tool_choice, provider_preference, custom_kind, verbosity, cache_plan

        api_key = str(self.api_key or "").strip()
        if not api_key:
            yield self._error_event("Invalid provider configuration")
            return

        request_body = self._prepare_request_body(
            messages,
            model,
            temperature,
            tools,
            max_tokens,
            thinking_config,
            thinking_mode,
            provider_settings,
        )
        yield ProviderEvent(kind="meta", raw_request=request_body)

        has_open_thinking = (
            has_unclosed_thinking_tag(request_body.get("messages", [])) if thinking_mode == "custom" else False
        )
        thinking_parser = ThinkingStreamParser(inside_thinking=has_open_thinking)
        native_tool_call_parser = NativeToolCallsStreamParser() if native_tool_call else None
        raw_chunks: list[dict[str, Any]] = []
        captured_usage: dict[str, int] | None = None
        finish_reason: str | None = None
        saw_tool_calls = False

        try:
            import httpx

            async with httpx.AsyncClient(timeout=get_llm_stream_timeout()) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_CLOUD_API_BASE}/chat",
                    headers=_headers(api_key),
                    json=request_body,
                ) as response:
                    if response.status_code >= 400:
                        body = (await response.aread()).decode("utf-8", errors="replace")
                        yield self._error_event(f"Request failed ({response.status_code}): {body}", response.status_code)
                        return

                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            yield self._error_event(f"Invalid Ollama stream line: {line}")
                            return
                        if not isinstance(chunk, dict):
                            continue
                        raw_chunks.append(chunk)
                        error = chunk.get("error")
                        if isinstance(error, str) and error:
                            yield self._error_event(error)
                            return

                        chunk_events = self._events_from_chunk(
                            chunk,
                            thinking_parser=thinking_parser,
                            native_tool_call_parser=native_tool_call_parser,
                        )
                        for event in chunk_events:
                            if event.delta and event.delta.tool_call_deltas:
                                saw_tool_calls = True
                            yield event
                        if native_tool_call_parser and native_tool_call_parser.tool_calls_completed:
                            yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))
                            return

                        if chunk.get("done") is True:
                            captured_usage = self._usage_from_chunk(chunk) or captured_usage
                            raw_finish = chunk.get("done_reason")
                            if isinstance(raw_finish, str) and raw_finish:
                                finish_reason = raw_finish
        except Exception as exc:
            yield self._error_event(str(exc))
            return

        try:
            for event in self._finalize_stream_parsers(thinking_parser, native_tool_call_parser):
                if event.delta and event.delta.tool_call_deltas:
                    saw_tool_calls = True
                yield event
            if native_tool_call_parser and native_tool_call_parser.tool_calls_completed:
                yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))
                return
        except Exception as exc:
            yield self._error_event(str(exc))
            return

        yield ProviderEvent(
            kind="meta",
            meta=MetaPayload(
                usage=captured_usage,
                finish_reason="tool_calls" if saw_tool_calls else (finish_reason or "stop"),
            ),
            raw_response={"chunks": raw_chunks} if raw_chunks else None,
        )

    @staticmethod
    def _error_event(message: str, status: Optional[int] = None) -> ProviderEvent:
        return ProviderEvent(
            kind="error",
            error=ProviderErrorPayload(message=message, status=status),
        )

    async def get_models(self) -> Dict:
        import asyncio
        import httpx

        api_key = str(self.api_key or "").strip()
        if not api_key:
            raise ValueError("Missing api_key for provider 'ollama_cloud'")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{OLLAMA_CLOUD_API_BASE}/tags", headers=_headers(api_key))
            if response.status_code >= 400:
                raise RuntimeError(f"Request failed ({response.status_code}): {response.text}")

            projected: list[dict[str, Any]] = []
            for item in _extract_model_items(response.json()):
                model = _project_model_item(item)
                if model is not None:
                    projected.append(model)

            # Enrich each model with its capabilities (vision, tools, ...) from /api/show.
            capabilities_list = await asyncio.gather(
                *(_fetch_model_capabilities(client, api_key, model["id"]) for model in projected)
            )
            for model, capabilities in zip(projected, capabilities_list):
                if capabilities is not None:
                    model["capabilities"] = capabilities

        return {"data": projected}


def create_provider(*, provider_config: dict[str, object], runtime_spec: object):
    del runtime_spec
    return OllamaCloudProvider(provider_config)

import base64
import copy
import inspect
import json
from typing import Any, AsyncGenerator, Dict, List, Optional

from google import genai
from google.genai import errors, types

from ..shared.base import BaseProvider
from ..shared.contracts import DeltaPayload, MetaPayload, ProviderErrorPayload, ProviderEvent
from ..shared.parsing.final_mappers import _to_raw_dict
from ..shared.parsing.multimodal import build_gemini_binary_parts, get_canonical_content_parts
from ..shared.parsing.native_tool_calls_parser import NativeToolCallsStreamParser
from ..shared.parsing.thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag
from ...services.prompt_cache_service import gemini_ttl_seconds
from ...utils.outbound_http import validate_outbound_base_url

GEMINI_THOUGHT_SIGNATURE_EXTRA_KEY = "gemini_thought_signature"


class GeminiProvider(BaseProvider):
    """Google Gemini provider with thought summaries / thinking support."""

    def __init__(self, config: Dict):
        super().__init__(config)
        self._client: Optional[genai.Client] = None
        raw_base_url = ((self.config or {}).get("base_url") or "").strip()
        allow_base_url_override = self.name.startswith("custom_")
        self._base_url: Optional[str] = (
            validate_outbound_base_url(raw_base_url) if (allow_base_url_override and raw_base_url) else None
        )
        if self.validate_config():
            self._client = self._build_client()

    # ------------------------------------------------------------------ #
    # Properties / client helpers
    # ------------------------------------------------------------------ #
    @property
    def name(self) -> str:
        return "gemini"

    @property
    def display_name(self) -> str:
        return "Gemini"

    @property
    def api_key(self) -> Optional[str]:
        return (self.config or {}).get("api_key")

    @property
    def base_url(self) -> Optional[str]:
        return self._base_url

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def _build_client(self) -> genai.Client:
        http_options = None
        if self.base_url:
            http_options = types.HttpOptions(baseUrl=self.base_url)
        return genai.Client(api_key=self.api_key, http_options=http_options)

    def _ensure_client(self) -> genai.Client:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    async def aclose(self) -> None:
        client = self._client
        self._client = None
        await self._close_sdk_client(client)

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        parts = []
        for detail in self._snapshot_reasoning_details(final_snapshot):
            if not isinstance(detail, dict):
                continue
            if detail.get("thought") is True:
                parts.append(detail)
                continue
            if isinstance(detail.get("thought_signature"), str) and detail.get("thought_signature"):
                parts.append(detail)

        reasoning_text = self._reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not parts and not reasoning_text:
            return None

        data: dict[str, Any] = {"parts": parts}
        meta: dict[str, Any] = {"provider": "gemini"}
        if reasoning_text:
            data["reasoning_text"] = reasoning_text
            meta["thinking_display"] = "reasoning_text"

        return {
            "type": "gemini",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return "reasoning_text"

    @staticmethod
    def _error_event(message: str, status: Optional[int] = None) -> ProviderEvent:
        return ProviderEvent(
            kind="error",
            error=ProviderErrorPayload(message=message, status=status),
        )

    @staticmethod
    def _to_reason_str(reason: Any) -> Optional[str]:
        if reason is None:
            return None
        if hasattr(reason, "name"):
            return str(reason.name)
        return str(reason)

    @classmethod
    def _normalize_finish_reason(cls, reason: Any, tool_calls_completed: bool = False) -> Optional[str]:
        if tool_calls_completed:
            return "tool_calls"

        reason_str = cls._to_reason_str(reason)
        if not reason_str:
            return None

        if reason_str in {"STOP", "FINISH_REASON_UNSPECIFIED"}:
            return "stop"
        if reason_str in {"MAX_TOKENS"}:
            return "length"
        if reason_str in {"TOOL_CALLS", "TOOL_USE"}:
            return "tool_calls"

        return reason_str.lower()

    @staticmethod
    def _to_chat_message_input(content: types.Content) -> Any:
        """Convert Content into chats.send_message(_stream)-compatible input."""
        parts = getattr(content, "parts", None) or []
        if len(parts) == 1:
            text = getattr(parts[0], "text", None)
            if isinstance(text, str):
                return text
        return parts

    @staticmethod
    def _normalize_thought_signature(value: Any) -> Optional[str]:
        if isinstance(value, str):
            return value or None
        if isinstance(value, (bytes, bytearray)):
            return base64.b64encode(bytes(value)).decode("utf-8")
        return None

    @classmethod
    def _part_thought_signature(cls, part: Any) -> Optional[str]:
        signature = getattr(part, "thought_signature", None)
        normalized = cls._normalize_thought_signature(signature)
        if normalized:
            return normalized

        raw: Dict[str, Any] = {}
        if isinstance(part, dict):
            raw = part
        elif hasattr(part, "model_dump"):
            dumped = part.model_dump()
            if isinstance(dumped, dict):
                raw = dumped

        return cls._normalize_thought_signature(
            raw.get("thought_signature") or raw.get("thoughtSignature")
        )

    @classmethod
    def _function_call_part_with_signature(cls, part: types.Part, signature: Optional[str]) -> types.Part:
        normalized = cls._normalize_thought_signature(signature)
        if not normalized:
            return part

        raw_part = _to_raw_dict(part)
        if raw_part:
            raw_part = dict(raw_part)
            raw_part["thought_signature"] = normalized
            try:
                return types.Part.model_validate(raw_part)
            except Exception:
                pass

        try:
            setattr(part, "thought_signature", normalized)
        except Exception:
            pass
        return part

    @classmethod
    def _function_call_delta_from_part(cls, *, part: Any, function_call: Any, index: int) -> Dict[str, Any]:
        arguments = getattr(function_call, "args", None) or {}
        tool_call_id = getattr(function_call, "id", None) or f"tool_call_{index + 1}"
        delta: Dict[str, Any] = {
            "index": index,
            "id": str(tool_call_id),
            "type": "function",
            "function": {
                "name": getattr(function_call, "name", None) or "",
                "arguments": json.dumps(arguments, ensure_ascii=False),
            },
        }
        signature = cls._part_thought_signature(part)
        if signature:
            delta["extra_content"] = {GEMINI_THOUGHT_SIGNATURE_EXTRA_KEY: signature}
        return delta

    # ------------------------------------------------------------------ #
    # Thinking config mapping
    # ------------------------------------------------------------------ #
    @staticmethod
    def _is_gemini3(model: str) -> bool:
        return "gemini-3" in model.lower()

    @staticmethod
    def _is_gemini25(model: str) -> bool:
        return "gemini-2.5" in model.lower()

    def _build_thinking_config(
        self, model: str, thinking_mode: Optional[str], thinking_config: Optional[Dict]
    ) -> Optional[Dict]:
        if thinking_mode == "custom":
            return None

        if thinking_mode == "off":
            if self._is_gemini25(model):
                return {"thinkingBudget": 0, "includeThoughts": False}
            return {"includeThoughts": False, "thinkingLevel": "low"}

        if thinking_mode != "model":
            return None

        config: Dict[str, object] = {"includeThoughts": True}

        if self._is_gemini3(model):
            level = "high"
            if thinking_config:
                lvl = thinking_config.get("gemini_thinking_level")
                if lvl in ("low", "medium", "high"):
                    level = lvl
            config["thinkingLevel"] = level
        else:
            if thinking_config and thinking_config.get("gemini_budget_tokens") is not None:
                config["thinkingBudget"] = thinking_config.get("gemini_budget_tokens")
        return config

    @staticmethod
    def _cached_content_name(value: Any) -> Optional[str]:
        name = getattr(value, "name", None)
        if isinstance(name, str) and name:
            return name
        if isinstance(value, dict):
            raw = value.get("name")
            if isinstance(raw, str) and raw:
                return raw
        return None

    async def _create_cached_content(
        self,
        *,
        client: genai.Client,
        model: str,
        contents: List[types.Content],
        system_instruction: Optional[types.Content],
        ttl_seconds: str,
    ) -> Optional[str]:
        aio_client = getattr(client, "aio", None)
        caches_api = getattr(aio_client, "caches", None) if aio_client is not None else getattr(client, "caches", None)
        create_fn = getattr(caches_api, "create", None)
        if not callable(create_fn):
            return None

        config_payload: Dict[str, Any] = {
            "contents": [_to_raw_dict(content) for content in contents],
            "ttl": ttl_seconds,
        }
        if system_instruction is not None:
            config_payload["system_instruction"] = _to_raw_dict(system_instruction)

        create_result = create_fn(model=model, config=config_payload)
        cache = await create_result if inspect.isawaitable(create_result) else create_result
        return self._cached_content_name(cache)

    # ------------------------------------------------------------------ #
    # Message conversion
    # ------------------------------------------------------------------ #
    def _convert_messages(self, messages: List[Dict]) -> Dict[str, object]:
        """Convert messages to Gemini format.

        Handles tool_calls in assistant messages by converting to Gemini function_call parts.
        """
        contents: List[types.Content] = []
        system_instruction: Optional[types.Content] = None
        parser_messages: List[Dict[str, str]] = []

        for msg in messages:
            role = msg.get("role", "user")
            canonical_parts = get_canonical_content_parts(msg)
            text = self._extract_text_content(msg)
            tool_calls = msg.get("tool_calls")
            reasoning_detail = msg.get("reasoning_detail") if isinstance(msg.get("reasoning_detail"), dict) else None

            if role == "system":
                if system_instruction is None and text:
                    system_instruction = types.Content(role="user", parts=[types.Part.from_text(text=text)])
                continue

            if role == "tool_results":
                tool_results = msg.get("tool_results", [])
                if tool_results:
                    parts = []
                    image_parts: list = []
                    for tr in tool_results:
                        parts.append(
                            types.Part.from_function_response(
                                name=tr.get("tool_name", ""),
                                response={"result": tr.get("content", "")},
                            )
                        )
                        for part in build_gemini_binary_parts(tr.get("image_parts") or []):
                            if part.get("type") == "binary":
                                image_parts.append(
                                    types.Part.from_bytes(
                                        data=part.get("data"),
                                        mime_type=str(part.get("mime_type") or ""),
                                    )
                                )
                    if parts:
                        contents.append(types.Content(role="user", parts=parts))
                    # functionResponse parts cannot carry images; deliver them in a following user turn.
                    if image_parts:
                        contents.append(types.Content(role="user", parts=image_parts))
                continue

            mapped_role = "user" if role == "user" else "model"

            reasoning_parts: List[types.Part] = []
            if role == "assistant" and isinstance(reasoning_detail, dict):
                reasoning_data = reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}
                raw_parts = reasoning_data.get("parts")
                if isinstance(raw_parts, list):
                    for part in raw_parts:
                        if not isinstance(part, dict):
                            continue
                        kwargs: Dict[str, Any] = {}
                        text_value = part.get("text")
                        if isinstance(text_value, str) and text_value:
                            kwargs["text"] = text_value
                        thought_signature = part.get("thought_signature")
                        thought_signature = self._normalize_thought_signature(thought_signature)
                        if thought_signature:
                            kwargs["thought_signature"] = thought_signature
                        if "thought" in part:
                            kwargs["thought"] = bool(part.get("thought"))
                        elif "thought_signature" in kwargs:
                            kwargs["thought"] = True
                        if "text" not in kwargs and "thought_signature" not in kwargs:
                            continue
                        try:
                            reasoning_parts.append(types.Part.model_validate(kwargs))
                        except Exception:
                            try:
                                reasoning_parts.append(types.Part.model_validate(part))
                            except Exception:
                                continue

            if role == "assistant" and tool_calls:
                parts = []
                if reasoning_parts:
                    parts.extend(reasoning_parts)
                for part in build_gemini_binary_parts(canonical_parts):
                    if part.get("type") == "text":
                        parts.append(types.Part.from_text(text=str(part.get("text") or "")))
                    elif part.get("type") == "binary":
                        parts.append(types.Part.from_bytes(data=part.get("data"), mime_type=str(part.get("mime_type") or "")))
                for tc in tool_calls:
                    tc_function = tc.get("function", {})
                    args_str = tc_function.get("arguments", "{}")
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    except json.JSONDecodeError:
                        args = {}
                    function_part = types.Part.from_function_call(name=tc_function.get("name", ""), args=args)
                    extra_content = tc.get("extra_content") if isinstance(tc.get("extra_content"), dict) else {}
                    thought_signature = extra_content.get(GEMINI_THOUGHT_SIGNATURE_EXTRA_KEY)
                    parts.append(self._function_call_part_with_signature(function_part, thought_signature))
                if parts:
                    contents.append(types.Content(role=mapped_role, parts=parts))
                if text:
                    parser_messages.append({"role": "assistant", "content": text})
            else:
                converted_parts = build_gemini_binary_parts(canonical_parts)
                if converted_parts or reasoning_parts:
                    parts = list(reasoning_parts)
                    for part in converted_parts:
                        if part.get("type") == "text":
                            parts.append(types.Part.from_text(text=str(part.get("text") or "")))
                        elif part.get("type") == "binary":
                            parts.append(types.Part.from_bytes(data=part.get("data"), mime_type=str(part.get("mime_type") or "")))
                    contents.append(types.Content(role=mapped_role, parts=parts))
                    if mapped_role == "model" and text:
                        parser_messages.append({"role": "assistant", "content": text})

        return {
            "contents": contents,
            "system_instruction": system_instruction,
            "parser_messages": parser_messages,
        }

    # ------------------------------------------------------------------ #
    # Streaming
    # ------------------------------------------------------------------ #
    TOOL_CHOICE_MODE_MAP = {
        "auto": types.FunctionCallingConfigMode.AUTO,
        "required": types.FunctionCallingConfigMode.ANY,
        "none": types.FunctionCallingConfigMode.NONE,
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
        provider_settings: Optional[Dict[str, Any]] = None,
        cache_plan: Any = None,
    ) -> AsyncGenerator[ProviderEvent, None]:
        del provider_preference, custom_kind, verbosity
        if not self.validate_config():
            yield self._error_event("Gemini API key is required")
            return

        client = self._ensure_client()
        msg_payload = self._convert_messages(messages)
        contents: List[types.Content] = msg_payload["contents"]
        system_instruction = msg_payload.get("system_instruction")
        parser_messages = msg_payload.get("parser_messages") if isinstance(msg_payload, dict) else None

        if not contents:
            yield self._error_event("Gemini stream request has no messages")
            return

        config_dict: Dict[str, object] = {
            "temperature": temperature,
        }
        if max_tokens is not None:
            config_dict["maxOutputTokens"] = max_tokens
        if system_instruction:
            config_dict["systemInstruction"] = system_instruction

        thinking_cfg = self._build_thinking_config(model, thinking_mode, thinking_config)
        if thinking_cfg:
            config_dict["thinkingConfig"] = thinking_cfg

        cache_config = self._cache_config_from_provider_settings(provider_settings)
        explicit_cache_enabled = (
            bool(cache_config.get("enabled", False))
            and bool(cache_config.get("explicit", True))
            and str(getattr(cache_plan, "provider_strategy", "") or "") == "gemini_explicit"
        )
        selected_prefix_count = int(getattr(cache_plan, "selected_provider_message_count", 0) or 0)
        selected_cache_handle = (
            str(getattr(cache_plan, "selected_cache_handle", "") or "")
            if explicit_cache_enabled
            else ""
        )
        selected_checkpoint_id = (
            str(getattr(cache_plan, "selected_checkpoint_id", "") or "")
            if explicit_cache_enabled
            else ""
        )

        if explicit_cache_enabled and selected_prefix_count > 0 and selected_prefix_count < len(contents):
            if not selected_cache_handle:
                ttl_seconds = gemini_ttl_seconds(str(getattr(cache_plan, "ttl_label", None) or cache_config.get("explicit_ttl_preset") or "1h"))
                selected_cache_handle = (
                    await self._create_cached_content(
                        client=client,
                        model=model,
                        contents=contents[:selected_prefix_count],
                        system_instruction=system_instruction,
                        ttl_seconds=ttl_seconds,
                    )
                    or ""
                )
            if selected_cache_handle:
                config_dict["cached_content"] = selected_cache_handle
                contents = contents[selected_prefix_count:]
                if system_instruction is not None:
                    system_instruction = None
                    config_dict.pop("systemInstruction", None)

        if tools:
            function_declarations: List[types.FunctionDeclaration] = []
            for fn in tools:
                try:
                    params = fn.get("parameters") if isinstance(fn.get("parameters"), dict) else None
                    decl = types.FunctionDeclaration(
                        name=fn.get("name"),
                        description=fn.get("description"),
                        parameters_json_schema=params,
                    )
                    function_declarations.append(decl)
                except Exception as exc:
                    yield self._error_event(f"Gemini function schema error: {exc}", 400)
                    return

            if function_declarations:
                tool = types.Tool(function_declarations=function_declarations)
                config_dict["tools"] = [tool]

            mode = self.TOOL_CHOICE_MODE_MAP.get(tool_choice or "auto", types.FunctionCallingConfigMode.AUTO)
            config_dict["tool_config"] = {
                "function_calling_config": {"mode": mode}
            }

        config = types.GenerateContentConfig.model_validate(config_dict)

        raw_req = {
            "model": model,
            "config": _to_raw_dict(config),
            "history": [_to_raw_dict(c) for c in contents[:-1]] if len(contents) > 1 else [],
            "current_input": _to_raw_dict(contents[-1]) if contents else {},
        }
        yield ProviderEvent(kind="meta", raw_request=raw_req)

        thinking_source = parser_messages if isinstance(parser_messages, list) else []
        has_open_thinking = has_unclosed_thinking_tag(thinking_source) if thinking_mode == "custom" else False
        parser = ThinkingStreamParser(inside_thinking=has_open_thinking)
        native_tc_parser = NativeToolCallsStreamParser() if native_tool_call else None

        tool_call_counter = 0
        stream = None
        chat = None
        captured_usage: Optional[Dict[str, int]] = None
        captured_reasoning_tokens: Optional[int] = None
        captured_cache_metrics: Optional[Dict[str, Any]] = None
        last_finish_reason: Any = None
        tool_finish_emitted = False

        try:
            history = contents[:-1]
            current_input = contents[-1]
            used_history_arg = True

            try:
                create_result = client.aio.chats.create(
                    model=model,
                    config=config,
                    history=history,
                )
            except TypeError:
                used_history_arg = False
                create_result = client.aio.chats.create(
                    model=model,
                    config=config,
                )

            chat = await create_result if inspect.isawaitable(create_result) else create_result

            # Fallback for SDK variants without create(history=...).
            if history and not used_history_arg and hasattr(chat, "send_message"):
                for hist_item in history:
                    send_hist = chat.send_message(self._to_chat_message_input(hist_item))
                    if inspect.isawaitable(send_hist):
                        await send_hist

            stream_result = chat.send_message_stream(self._to_chat_message_input(current_input))
            stream = await stream_result if inspect.isawaitable(stream_result) else stream_result

            raw_accumulated: Dict[str, Any] = {}

            async for chunk in stream:
                # Accumulate full raw chunk for raw response
                raw_full = _to_raw_dict(chunk)
                if isinstance(raw_full, dict):
                    for key, value in raw_full.items():
                        if key == "candidates":
                            continue
                        if value is not None:
                            raw_accumulated[key] = value
                    for i, cand in enumerate(raw_full.get("candidates", [])):
                        candidates = raw_accumulated.setdefault("candidates", [])
                        if i >= len(candidates):
                            candidates.append(copy.deepcopy(cand))
                        else:
                            new_parts = (cand.get("content") or {}).get("parts", [])
                            if new_parts:
                                acc_content = candidates[i].setdefault("content", {})
                                acc_content.setdefault("parts", []).extend(copy.deepcopy(new_parts))
                            for k, v in cand.items():
                                if k != "content" and v is not None:
                                    candidates[i][k] = v
                            role = (cand.get("content") or {}).get("role")
                            if role is not None:
                                candidates[i].setdefault("content", {})["role"] = role

                usage_meta = getattr(chunk, "usage_metadata", None)
                if usage_meta:
                    captured_usage = {
                        "prompt_tokens": int(getattr(usage_meta, "prompt_token_count", 0) or 0),
                        "completion_tokens": int(getattr(usage_meta, "candidates_token_count", 0) or 0),
                        "total_tokens": int(getattr(usage_meta, "total_token_count", 0) or 0),
                    }
                    thought_tokens = getattr(usage_meta, "thoughts_token_count", None)
                    if isinstance(thought_tokens, (int, float)):
                        captured_reasoning_tokens = int(thought_tokens)
                    cached_content_tokens = getattr(usage_meta, "cached_content_token_count", None)
                    if isinstance(cached_content_tokens, (int, float)):
                        captured_cache_metrics = {"cached_tokens": int(cached_content_tokens)}

                candidates = getattr(chunk, "candidates", None) or []
                for cand in candidates:
                    cand_finish_reason = getattr(cand, "finish_reason", None)
                    if cand_finish_reason is not None:
                        last_finish_reason = cand_finish_reason

                    content = getattr(cand, "content", None)
                    if not content:
                        continue

                    parts = getattr(content, "parts", None) or []
                    for part in parts:
                        if getattr(part, "function_call", None):
                            fc = part.function_call
                            tool_call_counter += 1

                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(
                                    tool_call_deltas=[
                                        self._function_call_delta_from_part(
                                            part=part,
                                            function_call=fc,
                                            index=tool_call_counter - 1,
                                        )
                                    ]
                                ),
                            )
                            continue

                        if getattr(part, "thought", False):
                            thought_text = getattr(part, "text", None) or ""
                            if thought_text:
                                yield ProviderEvent(
                                    kind="delta",
                                    delta=DeltaPayload(thinking_delta=thought_text),
                                )

                            signature = self._part_thought_signature(part)
                            thought_detail: Dict[str, Any] = {"thought": True}
                            if thought_text:
                                thought_detail["text"] = thought_text
                            if isinstance(signature, str) and signature:
                                thought_detail["thought_signature"] = signature
                            if thought_detail.get("text") or thought_detail.get("thought_signature"):
                                yield ProviderEvent(
                                    kind="delta",
                                    delta=DeltaPayload(
                                        reasoning_detail_delta=[thought_detail]
                                    ),
                                )
                            continue

                        text = getattr(part, "text", None)
                        if not text:
                            continue

                        text_to_emit = text
                        thinking_extra: Optional[str] = None
                        if parser:
                            clean, thinking_block = parser.process_chunk(text)
                            text_to_emit = clean
                            thinking_extra = thinking_block

                        tool_extra = None
                        if native_tc_parser and text_to_emit:
                            clean_content, tool_calls = native_tc_parser.process_chunk(text_to_emit)
                            text_to_emit = clean_content
                            tool_extra = tool_calls

                        if text_to_emit:
                            yield ProviderEvent(kind="delta", delta=DeltaPayload(content_delta=text_to_emit))

                        if thinking_extra:
                            yield ProviderEvent(kind="delta", delta=DeltaPayload(thinking_delta=thinking_extra))

                        if tool_extra:
                            yield ProviderEvent(kind="delta", delta=DeltaPayload(tool_call_deltas=tool_extra))

                        if native_tc_parser and native_tc_parser.tool_calls_completed and not tool_finish_emitted:
                            tool_finish_emitted = True
                            yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))

            final_content, final_thinking = parser.finalize()
            if final_content:
                if native_tc_parser:
                    clean_content, tool_calls = native_tc_parser.process_chunk(final_content)
                    if clean_content:
                        yield ProviderEvent(kind="delta", delta=DeltaPayload(content_delta=clean_content))
                    if tool_calls:
                        yield ProviderEvent(kind="delta", delta=DeltaPayload(tool_call_deltas=tool_calls))
                else:
                    yield ProviderEvent(kind="delta", delta=DeltaPayload(content_delta=final_content))

            if final_thinking:
                yield ProviderEvent(kind="delta", delta=DeltaPayload(thinking_delta=final_thinking))

            if native_tc_parser:
                tail_text, tail_tool_calls = native_tc_parser.finalize()
                if tail_text:
                    yield ProviderEvent(kind="delta", delta=DeltaPayload(content_delta=tail_text))
                if tail_tool_calls:
                    yield ProviderEvent(kind="delta", delta=DeltaPayload(tool_call_deltas=tail_tool_calls))
                if native_tc_parser.tool_calls_completed and not tool_finish_emitted:
                    tool_finish_emitted = True
                    yield ProviderEvent(kind="meta", meta=MetaPayload(finish_reason="tool_calls"))

            reason_str = self._to_reason_str(last_finish_reason)
            GEMINI_ERROR_REASONS = {
                "SAFETY": "Content blocked by safety filters",
                "MALFORMED_FUNCTION_CALL": "Function call was malformed",
                "UNEXPECTED_TOOL_CALL": "Model tried to call an unregistered tool",
                "RECITATION": "Response contained recited content",
                "PROHIBITED_CONTENT": "Content prohibited",
                "BLOCKLIST": "Content blocked by filter",
                "IMAGE_SAFETY": "Image blocked by safety filters",
                "SPII": "Sensitive personal information detected",
            }
            if reason_str in GEMINI_ERROR_REASONS:
                yield self._error_event(f"{GEMINI_ERROR_REASONS[reason_str]} ({reason_str})")
                return

            finish_reason = self._normalize_finish_reason(
                last_finish_reason,
                tool_calls_completed=bool(native_tc_parser and native_tc_parser.tool_calls_completed),
            )

            if captured_usage is not None or finish_reason is not None:
                if tool_finish_emitted and finish_reason == "tool_calls":
                    finish_reason = None
                yield ProviderEvent(
                    kind="meta",
                    meta=MetaPayload(
                        usage=captured_usage,
                        finish_reason=finish_reason,
                        reasoning_tokens=captured_reasoning_tokens,
                        cache_metrics={
                            **(captured_cache_metrics or {}),
                            **(
                                {
                                    "cache_handle": selected_cache_handle,
                                    "selected_checkpoint_id": selected_checkpoint_id,
                                }
                                if selected_cache_handle
                                else {}
                            ),
                        }
                        if captured_cache_metrics or selected_cache_handle
                        else None,
                    ),
                    raw_response=raw_accumulated if raw_accumulated else None,
                )

        except Exception as exc:  # pragma: no cover - stream errors surfaced via provider error event
            if isinstance(exc, errors.APIError):
                message = getattr(exc, "message", None) or str(exc)
                status = getattr(exc, "status", None) or getattr(exc, "code", None)
                yield self._error_event(message, status if isinstance(status, int) else None)
            else:
                status = (
                    getattr(exc, "code", None)
                    or getattr(exc, "status", None)
                    or getattr(exc, "status_code", None)
                    or getattr(exc, "http_status", None)
                )
                message = getattr(exc, "message", None) or str(exc)
                yield self._error_event(message, status if isinstance(status, int) else None)
            return
        finally:
            if stream is not None and hasattr(stream, "aclose"):
                try:
                    await stream.aclose()  # type: ignore[attr-defined]
                except Exception:
                    pass

    async def get_models(self) -> Dict:
        """Fetch available Gemini models from Google API."""
        if not self.validate_config():
            raise Exception("Gemini API key is required to fetch models")

        client = self._ensure_client()

        models = []
        for model in client.models.list():
            supported_actions = getattr(model, "supported_actions", []) or []
            if "generateContent" in supported_actions:
                model_name = getattr(model, "name", "") or ""
                models.append(
                    {
                        "id": model_name.replace("models/", ""),
                        "display_name": getattr(model, "display_name", None) or model_name,
                        "description": getattr(model, "description", None),
                        "input_token_limit": getattr(model, "input_token_limit", None),
                        "output_token_limit": getattr(model, "output_token_limit", None),
                    }
                )
        return {"data": models}


def create_provider(*, provider_config: Dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return GeminiProvider(provider_config)

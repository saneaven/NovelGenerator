import inspect
import json
from typing import Any, AsyncGenerator, Dict, List, Optional

from google import genai
from google.genai import errors, types

from .base import BaseProvider
from .contracts import DeltaPayload, MetaPayload, ProviderErrorPayload, ProviderEvent
from .native_tool_calls_parser import NativeToolCallsStreamParser
from .registry import ProviderRegistry
from .thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag
from ..utils.outbound_http import validate_outbound_base_url

@ProviderRegistry.register
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
                if lvl in ("low", "high"):
                    level = lvl
            config["thinkingLevel"] = level
        else:
            if thinking_config and thinking_config.get("gemini_budget_tokens") is not None:
                config["thinkingBudget"] = thinking_config.get("gemini_budget_tokens")
        return config

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
            text = self._extract_text_content(msg)
            tool_calls = msg.get("tool_calls")

            if role == "system":
                if system_instruction is None and text:
                    system_instruction = types.Content(role="user", parts=[types.Part.from_text(text=text)])
                continue

            if role == "tool_results":
                tool_results = msg.get("tool_results", [])
                if tool_results:
                    parts = []
                    for tr in tool_results:
                        parts.append(
                            types.Part.from_function_response(
                                name=tr.get("tool_name", ""),
                                response={"result": tr.get("content", "")},
                            )
                        )
                    if parts:
                        contents.append(types.Content(role="user", parts=parts))
                continue

            mapped_role = "user" if role == "user" else "model"

            if role == "assistant" and tool_calls:
                parts = []
                if text:
                    parts.append(types.Part.from_text(text=text))
                for tc in tool_calls:
                    tc_function = tc.get("function", {})
                    args_str = tc_function.get("arguments", "{}")
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    except json.JSONDecodeError:
                        args = {}
                    parts.append(types.Part.from_function_call(name=tc_function.get("name", ""), args=args))
                if parts:
                    contents.append(types.Content(role=mapped_role, parts=parts))
                if text:
                    parser_messages.append({"role": "assistant", "content": text})
            else:
                if text:
                    contents.append(types.Content(role=mapped_role, parts=[types.Part.from_text(text=text)]))
                    if mapped_role == "model":
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
        thinking_format: Optional[str] = None,
        request_format: Optional[str] = None,
        retry_config: Optional[Dict] = None,
        native_tool_call: bool = False,
    ) -> AsyncGenerator[ProviderEvent, None]:
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

        prefill_source = parser_messages if isinstance(parser_messages, list) else []
        prefill_has_thinking = has_unclosed_thinking_tag(prefill_source) if thinking_mode == "custom" else False
        parser = ThinkingStreamParser(inside_thinking=prefill_has_thinking)
        native_tc_parser = NativeToolCallsStreamParser() if native_tool_call else None

        tool_call_counter = 0
        stream = None
        chat = None
        captured_usage: Optional[Dict[str, int]] = None
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

            async for chunk in stream:
                usage_meta = getattr(chunk, "usage_metadata", None)
                if usage_meta:
                    captured_usage = {
                        "prompt_tokens": int(getattr(usage_meta, "prompt_token_count", 0) or 0),
                        "completion_tokens": int(getattr(usage_meta, "candidates_token_count", 0) or 0),
                        "total_tokens": int(getattr(usage_meta, "total_token_count", 0) or 0),
                    }

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
                        if getattr(part, "thought", False):
                            thought_text = getattr(part, "text", None) or ""
                            if thought_text:
                                yield ProviderEvent(
                                    kind="delta",
                                    delta=DeltaPayload(thinking_delta=thought_text),
                                )

                            signature = getattr(part, "thought_signature", None)
                            if signature is None and hasattr(part, "model_dump"):
                                signature = part.model_dump().get("thought_signature")

                            if signature:
                                if isinstance(signature, (bytes, bytearray)):
                                    import base64

                                    signature = base64.b64encode(signature).decode("utf-8")
                                yield ProviderEvent(
                                    kind="delta",
                                    delta=DeltaPayload(
                                        thinking_details_delta=[
                                            {"type": "signature", "signature": signature}
                                        ]
                                    ),
                                )
                            continue

                        if getattr(part, "function_call", None):
                            fc = part.function_call
                            arguments = fc.args or {}
                            tool_call_counter += 1
                            tool_call_id = getattr(fc, "id", None) or f"tool_call_{tool_call_counter}"

                            yield ProviderEvent(
                                kind="delta",
                                delta=DeltaPayload(
                                    tool_call_deltas=[
                                        {
                                            "index": tool_call_counter - 1,
                                            "id": str(tool_call_id),
                                            "type": "function",
                                            "function": {
                                                "name": fc.name or "",
                                                "arguments": json.dumps(arguments, ensure_ascii=False),
                                            },
                                        }
                                    ]
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
                    ),
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

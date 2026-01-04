import json
from typing import Any, AsyncGenerator, Dict, List, Optional

from google import genai
from google.genai import types, errors

from .base import BaseProvider
from .registry import ProviderRegistry
from .thinking_parser import ThinkingStreamParser, has_unclosed_thinking_tag


@ProviderRegistry.register
class GeminiProvider(BaseProvider):
    """Google Gemini provider with thought summaries / thinking support."""

    def __init__(self, config: Dict):
        super().__init__(config)
        self._client: Optional[genai.Client] = None
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
        return (self.config or {}).get("base_url")

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
            return None  # rely on <thinking> parser only

        if thinking_mode == "off":
            if self._is_gemini25(model):
                return {"thinkingBudget": 0, "includeThoughts": False}
            return {"includeThoughts": False, "thinkingLevel": "low"}

        if thinking_mode != "model":
            return None

        config: Dict[str, object] = {}
        config["includeThoughts"] = True

        if self._is_gemini3(model):
            level = "high"
            if thinking_config:
                lvl = thinking_config.get("gemini_thinking_level")
                if lvl in ("low", "high"):
                    level = lvl
            config["thinkingLevel"] = level
        else:
            # Gemini 2.5 budget-based thinking
            if thinking_config and thinking_config.get("gemini_budget_tokens") is not None:
                config["thinkingBudget"] = thinking_config.get("gemini_budget_tokens")
        return config

    # ------------------------------------------------------------------ #
    # Message conversion
    # ------------------------------------------------------------------ #
    def _convert_messages(self, messages: List[Dict]) -> Dict[str, object]:
        """Convert messages to Gemini format.

        Handles tool_calls in assistant messages by converting to Gemini's
        FunctionCall parts.
        """
        contents: List[types.Content] = []
        system_instruction: Optional[types.Content] = None

        for msg in messages:
            role = msg.get("role")
            text = msg.get("content") or ""
            tool_calls = msg.get("tool_calls")

            if role == "system":
                # First system message becomes systemInstruction; additional ones are appended as user content
                if system_instruction is None:
                    system_instruction = types.Content(role="user", parts=[types.Part.from_text(text=text)])
                    continue

            # Handle tool_results messages
            if role == "tool_results":
                tool_results = msg.get("tool_results", [])
                if tool_results:
                    parts = []
                    for tr in tool_results:
                        # Gemini uses from_function_response with name and response dict
                        parts.append(types.Part.from_function_response(
                            name=tr.get("function_name", ""),
                            response={"result": tr.get("content", "")}
                        ))
                    contents.append(types.Content(role="tool", parts=parts))
                continue

            mapped_role = "user" if role == "user" else "model"

            # Handle assistant messages with tool_calls
            if role == "assistant" and tool_calls:
                parts = []
                # Add text content if present
                if text:
                    parts.append(types.Part.from_text(text=text))
                # Convert tool_calls to Gemini FunctionCall parts
                for tc in tool_calls:
                    tc_function = tc.get("function", {})
                    args_str = tc_function.get("arguments", "{}")
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    except json.JSONDecodeError:
                        args = {}
                    # Create FunctionCall part using the SDK's method
                    parts.append(types.Part.from_function_call(
                        name=tc_function.get("name", ""),
                        args=args
                    ))
                contents.append(types.Content(role=mapped_role, parts=parts))
            else:
                contents.append(types.Content(role=mapped_role, parts=[types.Part.from_text(text=text)]))

        return {"contents": contents, "system_instruction": system_instruction}

    # ------------------------------------------------------------------ #
    # Streaming
    # ------------------------------------------------------------------ #
    # Mapping from unified tool_choice to Gemini's FunctionCallingConfigMode
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
        functions: Optional[List[Dict]] = None,
        tool_choice: Optional[str] = None,
        max_tokens: Optional[int] = None,
        provider_preference: Optional[Dict] = None,
        thinking_config: Optional[Dict] = None,
        thinking_mode: Optional[str] = None,
        custom_api_format: Optional[str] = None,
        retry_config: Optional[Dict] = None,
    ) -> AsyncGenerator[bytes, None]:
        if not self.validate_config():
            yield self._format_error("Gemini API key is required")
            return

        client = self._ensure_client()
        msg_payload = self._convert_messages(messages)
        contents = msg_payload["contents"]
        system_instruction = msg_payload.get("system_instruction")

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

        # Map function tools if provided
        if functions:
            function_declarations: List[types.FunctionDeclaration] = []
            for fn in functions:
                try:
                    params = fn.get("parameters") if isinstance(fn.get("parameters"), dict) else None
                    decl = types.FunctionDeclaration(
                        name=fn.get("name"),
                        description=fn.get("description"),
                        parameters_json_schema=params,
                    )
                    function_declarations.append(decl)
                except Exception as exc:
                    yield self._format_error(f"Gemini function schema error: {exc}", 400)
                    return

            if function_declarations:
                tool = types.Tool(function_declarations=function_declarations)
                config_dict["tools"] = [tool]

            mode = self.TOOL_CHOICE_MODE_MAP.get(tool_choice or "auto", types.FunctionCallingConfigMode.AUTO)
            config_dict["tool_config"] = {
                "function_calling_config": {"mode": mode}
            }

        # Convert to the SDK's strongly-typed config to avoid schema mismatches at runtime.
        config = types.GenerateContentConfig.model_validate(config_dict)

        # Check if prefill has unclosed <thinking> tag - parser should start inside thinking block
        # Always parse <thinking> tags from text content to prevent leakage into regular content
        prefill_has_thinking = has_unclosed_thinking_tag(messages) if thinking_mode == "custom" else False
        parser = ThinkingStreamParser(inside_thinking=prefill_has_thinking)
        tool_call_counter = 0
        stream = None

        try:
            stream = await client.aio.models.generate_content_stream(
                model=model,
                contents=contents,
                config=config,
            )

            last_finish_reason = None
            captured_usage: Optional[Dict] = None

            async for chunk in stream:
                # Capture usage_metadata from each chunk (the last one will have final totals)
                usage_meta = getattr(chunk, "usage_metadata", None)
                if usage_meta:
                    captured_usage = {
                        "prompt_tokens": getattr(usage_meta, "prompt_token_count", 0) or 0,
                        "completion_tokens": getattr(usage_meta, "candidates_token_count", 0) or 0,
                        "total_tokens": getattr(usage_meta, "total_token_count", 0) or 0,
                    }

                candidates = getattr(chunk, "candidates", None) or []
                for cand in candidates:
                    # Track finish_reason from each candidate
                    cand_finish_reason = getattr(cand, "finish_reason", None)
                    if cand_finish_reason is not None:
                        last_finish_reason = cand_finish_reason

                    content = getattr(cand, "content", None)
                    if not content:
                        continue

                    parts = getattr(content, "parts", None) or []
                    for part in parts:
                        # Thinking / thought summaries
                        if getattr(part, "thought", False):
                            thinking_payload = {
                                "choices": [
                                    {
                                        "delta": {
                                            "thinking": {
                                                "text": getattr(part, "text", None) or ""
                                            }
                                        }
                                    }
                                ]
                            }
                            # Optional signature if present
                            signature = getattr(part, "thought_signature", None) or (
                                part.model_dump().get("thought_signature") if hasattr(part, "model_dump") else None
                            )
                            if signature:
                                # thought_signature can be bytes; convert to base64 string to keep JSON serializable
                                if isinstance(signature, (bytes, bytearray)):
                                    import base64
                                    signature = base64.b64encode(signature).decode("utf-8")
                                thinking_payload["choices"][0]["delta"]["thinking"]["signature"] = signature
                            if self._has_meaningful_payload(thinking_payload):
                                yield self._format_sse(thinking_payload)
                            continue

                        # Function calls / tool calls
                        if getattr(part, "function_call", None):
                            fc = part.function_call
                            arguments = fc.args or {}
                            signature = getattr(part, "thought_signature", None) or (
                                part.model_dump().get("thought_signature") if hasattr(part, "model_dump") else None
                            )
                            if signature and isinstance(signature, (bytes, bytearray)):
                                import base64
                                signature = base64.b64encode(signature).decode("utf-8")
                            # Ensure each distinct function call has a stable, unique id
                            if getattr(fc, "id", None):
                                # tool_call_id = fc.id
                                tool_call_counter += 1
                                tool_call_id = f"tool_call_{tool_call_counter}"
                            else:
                                tool_call_counter += 1
                                tool_call_id = f"tool_call_{tool_call_counter}"
                            delta: Dict[str, Any] = {
                                "tool_calls": [
                                    {
                                        "id": tool_call_id,
                                        "type": "function",
                                        "function": {
                                            "name": fc.name or "",
                                            "arguments": json.dumps(arguments),
                                        },
                                    }
                                ]
                            }
                            # Gemini 3 function calls carry a thought signature that must be
                            # returned on the next turn; expose it alongside the tool call.
                            if signature:
                                delta["thinking"] = {"signature": signature}

                            payload = {"choices": [{"delta": delta}]}
                            if self._has_meaningful_payload(payload):
                                yield self._format_sse(payload)
                            continue

                        text = getattr(part, "text", None)
                        if text:
                            extra_chunks: List[Dict] = []
                            text_to_emit = text
                            if parser:
                                clean, thinking_block = parser.process_chunk(text)
                                text_to_emit = clean
                                if thinking_block:
                                    extra_chunks.append(
                                        {"choices": [{"delta": {"thinking": {"text": thinking_block}}}]}
                                    )

                            if text_to_emit:
                                payload = {"choices": [{"delta": {"content": text_to_emit}}]}
                                if self._has_meaningful_payload(payload):
                                    yield self._format_sse(payload)

                            for extra in extra_chunks:
                                if self._has_meaningful_payload(extra):
                                    yield self._format_sse(extra)

            for final_chunk in self._finalize_parser(parser):
                if self._has_meaningful_payload(final_chunk):
                    yield self._format_sse(final_chunk)

            # Check for error finish_reasons and emit error if needed
            if last_finish_reason is not None:
                reason_str = (
                    last_finish_reason.name
                    if hasattr(last_finish_reason, "name")
                    else str(last_finish_reason)
                )

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
                    yield self._format_error(f"{GEMINI_ERROR_REASONS[reason_str]} ({reason_str})")
                    return  # Don't yield [DONE] after error

            # Emit usage information before [DONE]
            if captured_usage:
                usage_payload = {"usage": captured_usage}
                yield self._format_sse(usage_payload)

            yield b"data: [DONE]\n\n"

        except Exception as exc:  # pragma: no cover - stream errors surfaced via SSE
            # Prefer structured API errors from google.genai
            if isinstance(exc, errors.APIError):
                message = getattr(exc, "message", None) or str(exc)
                status = getattr(exc, "status", None) or getattr(exc, "code", None)
                yield self._format_error(message, status)
            else:
                status = (
                    getattr(exc, "code", None)
                    or getattr(exc, "status", None)
                    or getattr(exc, "status_code", None)
                    or getattr(exc, "http_status", None)
                )
                message = getattr(exc, "message", None) or str(exc)
                yield self._format_error(message, status)
        finally:
            # Cleanup Gemini stream using standard async generator close
            if stream is not None and hasattr(stream, 'aclose'):
                try:
                    await stream.aclose()  # type: ignore
                except Exception:
                    pass  # Ignore errors during cleanup

    async def get_models(self) -> Dict:
        """
        Fetch available Gemini models from Google API.
        """
        if not self.validate_config():
            raise Exception("Gemini API key is required to fetch models")

        client = self._ensure_client()

        models = []
        for model in client.models.list():
            # Only include models that support generateContent
            supported_actions = getattr(model, "supported_actions", []) or []
            if "generateContent" in supported_actions:
                model_name = getattr(model, "name", "") or ""
                models.append({
                    "id": model_name.replace("models/", ""),
                    "display_name": getattr(model, "display_name", None) or model_name,
                    "description": getattr(model, "description", None),
                    "input_token_limit": getattr(model, "input_token_limit", None),
                    "output_token_limit": getattr(model, "output_token_limit", None),
                })
        return {"data": models}

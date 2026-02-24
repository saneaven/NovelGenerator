from __future__ import annotations

from typing import Any, Protocol

from .custom_template_runtime import get_nested_path, set_nested_path


def _copy_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for message in messages:
        copied = dict(message)
        if isinstance(copied.get("content_parts"), list):
            copied["content_parts"] = [dict(part) if isinstance(part, dict) else part for part in copied["content_parts"]]
        if isinstance(copied.get("tool_calls"), list):
            copied["tool_calls"] = [dict(call) if isinstance(call, dict) else call for call in copied["tool_calls"]]
        if isinstance(copied.get("tool_results"), list):
            copied["tool_results"] = [dict(item) if isinstance(item, dict) else item for item in copied["tool_results"]]
        if isinstance(copied.get("reasoning_detail"), dict):
            copied["reasoning_detail"] = dict(copied["reasoning_detail"])
        out.append(copied)
    return out


def _snapshot_reasoning_details(final_snapshot: Any) -> list[dict[str, Any]]:
    raw = getattr(final_snapshot, "reasoning_details", None)
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _snapshot_reasoning_tokens(final_snapshot: Any) -> int | None:
    value = getattr(final_snapshot, "reasoning_tokens", None)
    if isinstance(value, bool):
        value = int(value)
    if isinstance(value, int):
        return max(0, value)
    return None


def _reasoning_text_from_parts(content_parts: Any) -> str:
    if not isinstance(content_parts, list):
        return ""
    chunks: list[str] = []
    for part in content_parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "thinking":
            continue
        text = part.get("text")
        if isinstance(text, str) and text:
            chunks.append(text)
    return "".join(chunks)


def _read_openrouter_format(details: list[dict[str, Any]]) -> str | None:
    for detail in details:
        fmt = detail.get("format") if isinstance(detail, dict) else None
        if isinstance(fmt, str) and fmt.strip():
            return fmt
    return None


def _filter_openai_reasoning_items(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            continue
        compact: dict[str, Any] = {
            "id": item_id,
            "type": str(item.get("type") or "reasoning"),
        }
        encrypted = item.get("encrypted_content")
        if isinstance(encrypted, str) and encrypted:
            compact["encrypted_content"] = encrypted
        summary = item.get("summary")
        if isinstance(summary, (str, list, dict)):
            compact["summary"] = summary
        else:
            compact["summary"] = []
        out.append(compact)
    return out


def _append_string_path(target: dict[str, Any], path: str, value: str) -> None:
    existing = get_nested_path(target, path)
    if isinstance(existing, str):
        set_nested_path(target, path, existing + value)
    else:
        set_nested_path(target, path, value)


def _first_stream_template_var(template: dict[str, Any] | None) -> str | None:
    if not isinstance(template, dict):
        return None
    response_fields = template.get("response_fields")
    if not isinstance(response_fields, list):
        return None
    for field in response_fields:
        if not isinstance(field, dict):
            continue
        if not bool(field.get("is_stream_delta")):
            continue
        as_var = field.get("as_var")
        if isinstance(as_var, str) and as_var.strip():
            return as_var.strip()
    return None


class ProviderIO(Protocol):
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        ...

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        ...

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        ...

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        ...


class BaseProviderIO:
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        return _copy_messages(messages)

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        return None

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        return _snapshot_reasoning_tokens(final_snapshot)

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return None


class OpenAIResponsesIO(BaseProviderIO):
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        out = _copy_messages(messages)
        for message in out:
            if message.get("role") != "assistant":
                continue
            reasoning_detail = message.get("reasoning_detail")
            if not isinstance(reasoning_detail, dict):
                continue
            data = reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}
            items = _filter_openai_reasoning_items(data.get("items"))
            if items:
                new_data: dict[str, Any] = {"items": items}
                output_msg_id = data.get("output_msg_id")
                if isinstance(output_msg_id, str) and output_msg_id:
                    new_data["output_msg_id"] = output_msg_id
                fc_item_ids = data.get("function_call_item_ids")
                if isinstance(fc_item_ids, dict) and fc_item_ids:
                    new_data["function_call_item_ids"] = fc_item_ids
                reasoning_detail["data"] = new_data
                message["reasoning_detail"] = reasoning_detail
            else:
                message.pop("reasoning_detail", None)
        return out

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        items = _filter_openai_reasoning_items(_snapshot_reasoning_details(final_snapshot))
        reasoning_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not items and not reasoning_text:
            return None
        data: dict[str, Any] = {"items": items}
        # Extract output message ID from raw native response so that multi-turn
        # input can pair reasoning items with their following output message.
        raw = getattr(final_snapshot, "raw_native_response", None)
        if isinstance(raw, dict):
            for output_item in raw.get("output") or []:
                if not isinstance(output_item, dict):
                    continue
                if output_item.get("type") == "message":
                    msg_id = output_item.get("id")
                    if isinstance(msg_id, str) and msg_id:
                        data["output_msg_id"] = msg_id
                elif output_item.get("type") == "function_call":
                    call_id = output_item.get("call_id")
                    item_id = output_item.get("id")
                    if isinstance(call_id, str) and call_id and isinstance(item_id, str) and item_id:
                        fc_ids = data.setdefault("function_call_item_ids", {})
                        fc_ids[call_id] = item_id
        meta: dict[str, Any] = {"provider": "openai"}
        if reasoning_text:
            data["reasoning_text"] = reasoning_text
            meta["thinking_display"] = "reasoning_text"
        return {
            "type": "openai",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return "reasoning_text"


class GeminiIO(BaseProviderIO):
    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        parts = []
        for detail in _snapshot_reasoning_details(final_snapshot):
            if not isinstance(detail, dict):
                continue
            if detail.get("thought") is True:
                parts.append(detail)
                continue
            if isinstance(detail.get("thought_signature"), str) and detail.get("thought_signature"):
                parts.append(detail)

        reasoning_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
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


class ClaudeIO(BaseProviderIO):
    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        blocks: list[dict[str, Any]] = []
        for block in _snapshot_reasoning_details(final_snapshot):
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

        reasoning_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
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


class OpenRouterIO(BaseProviderIO):
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        out = _copy_messages(messages)
        for message in out:
            if message.get("role") != "assistant":
                continue
            reasoning_detail = message.get("reasoning_detail")
            if not isinstance(reasoning_detail, dict):
                continue
            data = reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}
            meta = reasoning_detail.get("meta") if isinstance(reasoning_detail.get("meta"), dict) else {}
            details = data.get("reasoning_details") if isinstance(data.get("reasoning_details"), list) else []
            expected_format = meta.get("openrouter_reasoning_format")
            if isinstance(expected_format, str) and expected_format.strip():
                details = [
                    d for d in details
                    if not isinstance(d, dict) or d.get("format") == expected_format
                ]
            next_data = dict(data)
            next_data["reasoning_details"] = [d for d in details if isinstance(d, dict)]
            reasoning_detail["data"] = next_data
            message["reasoning_detail"] = reasoning_detail
        return out

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        details = _snapshot_reasoning_details(final_snapshot)
        reasoning_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not reasoning_text:
            return None
        meta: dict[str, Any] = {"provider": "openrouter"}
        fmt = _read_openrouter_format(details)
        if isinstance(fmt, str):
            meta["openrouter_reasoning_format"] = fmt
        data: dict[str, Any] = {
            "reasoning_details": details,
        }
        if reasoning_text:
            data["reasoning"] = reasoning_text
            meta["thinking_display"] = "reasoning"
        return {
            "type": "openrouter",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return "reasoning"


class XaiIO(BaseProviderIO):
    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        details = _snapshot_reasoning_details(final_snapshot)
        reasoning_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not reasoning_text:
            return None
        data: dict[str, Any] = {
            "details": details,
        }
        meta: dict[str, Any] = {
            "provider": "xai",
        }
        if reasoning_text:
            data["reasoning_text"] = reasoning_text
            meta["thinking_display"] = "reasoning_text"
        return {
            "type": "xai",
            "meta": meta,
            "data": data,
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        return "reasoning_text"


class CustomOpenAICompatIO(BaseProviderIO):
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        from .custom_template_runtime import build_history_inject

        out = _copy_messages(messages)
        template_id = advanced.get("custom_thinking_template_id")
        template = advanced.get("_resolved_template")

        for message in out:
            if message.get("role") != "assistant":
                continue
            reasoning_detail = message.get("reasoning_detail")
            if not isinstance(reasoning_detail, dict):
                continue

            meta = reasoning_detail.get("meta") if isinstance(reasoning_detail.get("meta"), dict) else {}

            if template_id:
                detail_tid = meta.get("custom_thinking_template_id")
                # Template mismatch -> drop reasoning
                if detail_tid != template_id:
                    message.pop("reasoning_detail", None)
                    continue

                # Build history injection map for matching template reasoning
                if template and reasoning_detail.get("type") == "openai_compatible_template":
                    data = reasoning_detail.get("data") if isinstance(reasoning_detail.get("data"), dict) else {}
                    inject = build_history_inject(data, template.get("history_fields") or [])
                    if inject:
                        message["_template_history_inject"] = inject
                    message.pop("reasoning_detail", None)
            else:
                # No template selected -> cannot inject reasoning back, drop it.
                message.pop("reasoning_detail", None)

        return out

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        template_id = advanced.get("custom_thinking_template_id")
        details = _snapshot_reasoning_details(final_snapshot)
        thinking_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))

        if template_id:
            var_data: dict[str, Any] = {}
            for item in details:
                var_name = item.get("_template_var")
                value = item.get("value")
                if not isinstance(var_name, str) or not var_name.strip():
                    continue
                path = var_name.strip()
                if isinstance(value, str):
                    _append_string_path(var_data, path, value)
                elif value is not None:
                    set_nested_path(var_data, path, value)

            if not var_data:
                return None

            meta: dict[str, Any] = {
                "provider": "custom",
                "custom_thinking_template_id": template_id,
            }
            stream_path = self.get_stream_thinking_display_path(advanced)
            if stream_path:
                meta["thinking_display"] = stream_path

            return {
                "type": "openai_compatible_template",
                "meta": meta,
                "data": var_data,
                "token_count": 0,
            }

        # Non-template custom mode stores only text.
        if not thinking_text.strip():
            return None
        return {
            "type": "custom",
            "meta": {
                "provider": "custom",
                "thinking_display": "text",
            },
            "data": {"text": thinking_text},
            "token_count": 0,
        }

    def get_stream_thinking_display_path(self, advanced: dict[str, Any]) -> str | None:
        template_id = advanced.get("custom_thinking_template_id")
        if template_id:
            return _first_stream_template_var(
                advanced.get("_resolved_template") if isinstance(advanced.get("_resolved_template"), dict) else None
            )
        return "text"


def get_provider_io(provider: str, advanced: dict[str, Any]) -> ProviderIO:
    provider_name = str(provider or "").strip().lower()
    if provider_name == "openai":
        return OpenAIResponsesIO()
    if provider_name == "gemini":
        return GeminiIO()
    if provider_name == "claude":
        return ClaudeIO()
    if provider_name == "openrouter":
        return OpenRouterIO()
    if provider_name == "custom":
        return CustomOpenAICompatIO()
    if provider_name == "xai":
        return XaiIO()
    return BaseProviderIO()


__all__ = [
    "ProviderIO",
    "get_provider_io",
    "OpenAIResponsesIO",
    "GeminiIO",
    "ClaudeIO",
    "OpenRouterIO",
    "CustomOpenAICompatIO",
    "XaiIO",
]

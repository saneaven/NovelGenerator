from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


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
        if isinstance(summary, (str, list, dict)) and summary:
            compact["summary"] = summary
        out.append(compact)
    return out


class ProviderIO(Protocol):
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        ...

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        ...

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        ...


class BaseProviderIO:
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        return _copy_messages(messages)

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        return None

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        return _snapshot_reasoning_tokens(final_snapshot)


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
                reasoning_detail["data"] = {"items": items}
                message["reasoning_detail"] = reasoning_detail
            else:
                message.pop("reasoning_detail", None)
        return out

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        items = _filter_openai_reasoning_items(_snapshot_reasoning_details(final_snapshot))
        if not items:
            return None
        return {
            "type": "openai",
            "meta": {"provider": "openai"},
            "data": {"items": items},
            "token_count": 0,
        }


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
        if not parts:
            return None
        return {
            "type": "gemini",
            "meta": {"provider": "gemini"},
            "data": {"parts": parts},
            "token_count": 0,
        }


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
        if not blocks:
            return None
        return {
            "type": "claude",
            "meta": {"provider": "claude"},
            "data": {"blocks": blocks},
            "token_count": 0,
        }

    def read_reasoning_tokens(self, final_snapshot: Any) -> int | None:
        return None


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
        thinking_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not thinking_text:
            return None
        meta: dict[str, Any] = {"provider": "openrouter"}
        fmt = _read_openrouter_format(details)
        if isinstance(fmt, str):
            meta["openrouter_reasoning_format"] = fmt
        return {
            "type": "openrouter",
            "meta": meta,
            "data": {
                "reasoning": thinking_text,
                "reasoning_details": details,
            },
            "token_count": 0,
        }


@dataclass
class OpenAICompatibleIO(BaseProviderIO):
    provider_name: str

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        details = _snapshot_reasoning_details(final_snapshot)
        thinking_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))
        if not details and not thinking_text:
            return None
        meta: dict[str, Any] = {"provider": self.provider_name}
        return {
            "type": "openai_compatible",
            "meta": meta,
            "data": {"details": details, "text": thinking_text},
            "token_count": 0,
        }


class CustomOpenAICompatIO(BaseProviderIO):
    def to_provider_messages(self, messages: list[dict[str, Any]], model: str, advanced: dict[str, Any]) -> list[dict[str, Any]]:
        out = _copy_messages(messages)
        current_format = str(advanced.get("thinking_format") or "openai").strip().lower()
        for message in out:
            if message.get("role") != "assistant":
                continue
            reasoning_detail = message.get("reasoning_detail")
            if not isinstance(reasoning_detail, dict):
                continue
            meta = reasoning_detail.get("meta") if isinstance(reasoning_detail.get("meta"), dict) else {}
            detail_format = str(meta.get("openai_compatible_thinking_format") or "").strip().lower()
            if detail_format and detail_format != current_format:
                message.pop("reasoning_detail", None)
        return out

    def read_reasoning_detail(self, final_snapshot: Any, advanced: dict[str, Any]) -> dict[str, Any] | None:
        thinking_format = str(advanced.get("thinking_format") or "openai").strip().lower()
        request_format = str(advanced.get("request_format") or "openai_sdk").strip().lower()

        details = _snapshot_reasoning_details(final_snapshot)
        thinking_text = _reasoning_text_from_parts(getattr(final_snapshot, "content_parts", None))

        if thinking_format == "claude" and request_format != "claude_sdk":
            payload: dict[str, Any] = {"text": thinking_text}
        else:
            payload = {"details": details, "text": thinking_text}

        has_payload = bool(payload.get("details")) or bool(str(payload.get("text") or "").strip())
        if not has_payload:
            return None

        return {
            "type": "openai_compatible",
            "meta": {
                "provider": "custom",
                "openai_compatible_thinking_format": thinking_format,
            },
            "data": payload,
            "token_count": 0,
        }


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
        return OpenAICompatibleIO(provider_name="xai")
    return BaseProviderIO()


__all__ = [
    "ProviderIO",
    "get_provider_io",
    "OpenAIResponsesIO",
    "GeminiIO",
    "ClaudeIO",
    "OpenRouterIO",
    "CustomOpenAICompatIO",
    "OpenAICompatibleIO",
]

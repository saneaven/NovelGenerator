"""Single token counting entrypoint used by pipeline and API routes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session

from .credential_service import CredentialServiceError, credential_service
from .token_counting_service import (
    count_tokens_claude,
    count_tokens_claude_messages,
    count_tokens_gemini,
    count_tokens_gemini_contents,
)

try:
    import tiktoken
except Exception:
    tiktoken = None


TokenizerName = Literal["openai", "claude", "gemini"]
ProviderName = Literal["openai", "gemini", "claude", "openrouter", "custom", "xai"]
CountMethod = Literal["tiktoken", "claude_api", "gemini_api"]


@dataclass(frozen=True)
class TokenCountResult:
    token_count: int
    provider: ProviderName
    model: str
    effective_tokenizer: TokenizerName
    is_estimate: bool
    fallback_used: bool
    method: CountMethod


_TIKTOKEN_ENCODERS: dict[str, Any] = {}


def _normalize_provider(provider: str) -> ProviderName:
    normalized = str(provider or "").strip().lower()
    if normalized not in {"openai", "gemini", "claude", "openrouter", "custom", "xai"}:
        raise ValueError(f"Unsupported provider: {provider}")
    return normalized  # type: ignore[return-value]


def _normalize_tokenizer_override(tokenizer_override: str | None) -> TokenizerName | None:
    if tokenizer_override is None:
        return None
    normalized = str(tokenizer_override).strip().lower()
    if normalized in {"openai", "claude", "gemini"}:
        return normalized  # type: ignore[return-value]
    return None


def resolve_tokenizer(provider: str, tokenizer_override: str | None = None) -> TokenizerName:
    override = _normalize_tokenizer_override(tokenizer_override)
    if override is not None:
        return override

    provider_name = _normalize_provider(provider)
    if provider_name == "claude":
        return "claude"
    if provider_name == "gemini":
        return "gemini"
    return "openai"


def _encoding_for_model(model: str) -> str:
    lower_model = str(model or "").lower()
    if (
        "gpt-4o" in lower_model
        or "gpt-5" in lower_model
        or "o1" in lower_model
        or "o3" in lower_model
    ):
        return "o200k_base"
    return "cl100k_base"


def _count_tokens_tiktoken(text: str, model: str) -> int:
    encoding_name = _encoding_for_model(model)
    encoder = _TIKTOKEN_ENCODERS.get(encoding_name)
    if encoder is None:
        encoder = tiktoken.get_encoding(encoding_name)
        _TIKTOKEN_ENCODERS[encoding_name] = encoder
    return len(encoder.encode(text))


def _extract_api_key(provider_config: dict[str, Any]) -> str:
    return str(provider_config.get("api_key") or provider_config.get("apiKey") or "").strip()


async def count_text_tokens(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    model: str,
    text: str,
    tokenizer_override: str | None = None,
    allow_custom_base_url: bool = True,
) -> TokenCountResult:
    provider_name = _normalize_provider(provider)
    tokenizer = resolve_tokenizer(provider_name, tokenizer_override)
    safe_model = str(model or "").strip()
    safe_text = str(text or "")

    if not safe_text:
        return TokenCountResult(
            token_count=0,
            provider=provider_name,
            model=safe_model,
            effective_tokenizer=tokenizer,
            is_estimate=(tokenizer == "openai"),
            fallback_used=False,
            method="tiktoken" if tokenizer == "openai" else ("claude_api" if tokenizer == "claude" else "gemini_api"),
        )

    primary_error: Exception | None = None

    if tokenizer == "openai":
        count = _count_tokens_tiktoken(safe_text, safe_model)
        return TokenCountResult(
            token_count=count,
            provider=provider_name,
            model=safe_model,
            effective_tokenizer=tokenizer,
            is_estimate=True,
            fallback_used=False,
            method="tiktoken",
        )

    if tokenizer == "claude":
        try:
            target_provider = "claude"
            provider_config = credential_service.get_provider_config(db, user_id, target_provider)
            api_key = _extract_api_key(provider_config)
            if not api_key:
                raise CredentialServiceError("Credential for provider 'claude' not found")
            base_url_raw = provider_config.get("base_url") if allow_custom_base_url else None
            base_url = str(base_url_raw).strip() if isinstance(base_url_raw, str) and base_url_raw.strip() else None
            count = await count_tokens_claude(safe_text, safe_model, api_key, base_url)
            return TokenCountResult(
                token_count=count,
                provider=provider_name,
                model=safe_model,
                effective_tokenizer=tokenizer,
                is_estimate=False,
                fallback_used=False,
                method="claude_api",
            )
        except Exception as exc:
            primary_error = exc

    if tokenizer == "gemini":
        try:
            target_provider = "gemini"
            provider_config = credential_service.get_provider_config(db, user_id, target_provider)
            api_key = _extract_api_key(provider_config)
            if not api_key:
                raise CredentialServiceError("Credential for provider 'gemini' not found")
            base_url_raw = provider_config.get("base_url") if allow_custom_base_url else None
            base_url = str(base_url_raw).strip() if isinstance(base_url_raw, str) and base_url_raw.strip() else None
            count = await count_tokens_gemini(safe_text, safe_model, api_key, base_url)
            return TokenCountResult(
                token_count=count,
                provider=provider_name,
                model=safe_model,
                effective_tokenizer=tokenizer,
                is_estimate=False,
                fallback_used=False,
                method="gemini_api",
            )
        except Exception as exc:
            primary_error = exc

    # Global fallback policy: tiktoken only (no char-based estimation).
    try:
        count = _count_tokens_tiktoken(safe_text, safe_model)
        return TokenCountResult(
            token_count=count,
            provider=provider_name,
            model=safe_model,
            effective_tokenizer=tokenizer,
            is_estimate=True,
            fallback_used=True,
            method="tiktoken",
        )
    except Exception as fallback_exc:
        if primary_error is not None:
            raise RuntimeError(
                f"Token counting failed (primary={tokenizer}, provider={provider_name}): {primary_error}; "
                f"tiktoken fallback failed: {fallback_exc}"
            ) from fallback_exc
        raise RuntimeError(f"Token counting failed with unknown error; tiktoken fallback failed: {fallback_exc}") from fallback_exc


def _content_text(message: dict[str, Any]) -> str:
    parts = message.get("content_parts")
    content_parts: list[dict[str, Any]] = parts if isinstance(parts, list) else []
    return "".join(
        str(part.get("text") or "")
        for part in content_parts
        if isinstance(part, dict) and part.get("type") == "content"
    )


def _compact_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]]:
    tool_calls = message.get("tool_calls")
    if not isinstance(tool_calls, list):
        return []
    compact: list[dict[str, Any]] = []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        compact.append(
            {
                "id": call.get("id"),
                "type": call.get("type"),
                "function": call.get("function"),
                "extra_content": call.get("extra_content"),
            }
        )
    return compact


def _parse_tool_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _openai_message_payload_text(message: dict[str, Any]) -> str:
    payload = {
        "role": str(message.get("role") or ""),
        "content": _content_text(message),
        "tool_calls": _compact_tool_calls(message),
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def count_openai_message_tokens(model: str, message: dict[str, Any]) -> int:
    return _count_tokens_tiktoken(_openai_message_payload_text(message), model)


async def count_claude_message_tokens(
    db: Session,
    *,
    user_id: UUID,
    model: str,
    message: dict[str, Any],
    allow_custom_base_url: bool = True,
) -> int:
    provider_config = credential_service.get_provider_config(db, user_id, "claude")
    api_key = _extract_api_key(provider_config)
    if not api_key:
        raise CredentialServiceError("Credential for provider 'claude' not found")
    base_url_raw = provider_config.get("base_url") if allow_custom_base_url else None
    base_url = str(base_url_raw).strip() if isinstance(base_url_raw, str) and base_url_raw.strip() else None

    role = "assistant" if str(message.get("role") or "") == "assistant" else "user"
    content_blocks: list[dict[str, Any]] = []
    content_text = _content_text(message)
    if content_text:
        content_blocks.append({"type": "text", "text": content_text})
    for tool_call in _compact_tool_calls(message):
        function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
        content_blocks.append(
            {
                "type": "tool_use",
                "id": str(tool_call.get("id") or ""),
                "name": str(function.get("name") or ""),
                "input": _parse_tool_arguments(function.get("arguments")),
            }
        )

    if not content_blocks:
        return 0

    claude_messages: list[dict[str, Any]]
    claude_messages = [{"role": role, "content": content_blocks}]

    return await count_tokens_claude_messages(
        claude_messages,
        model=model,
        api_key=api_key,
        base_url=base_url,
    )


async def count_gemini_message_tokens(
    db: Session,
    *,
    user_id: UUID,
    model: str,
    message: dict[str, Any],
    allow_custom_base_url: bool = True,
) -> int:
    from google.genai import types as gemini_types

    provider_config = credential_service.get_provider_config(db, user_id, "gemini")
    api_key = _extract_api_key(provider_config)
    if not api_key:
        raise CredentialServiceError("Credential for provider 'gemini' not found")
    base_url_raw = provider_config.get("base_url") if allow_custom_base_url else None
    base_url = str(base_url_raw).strip() if isinstance(base_url_raw, str) and base_url_raw.strip() else None

    role = "model" if str(message.get("role") or "") == "assistant" else "user"
    parts: list[Any] = []
    content_text = _content_text(message)
    if content_text:
        parts.append(gemini_types.Part.from_text(text=content_text))
    for tool_call in _compact_tool_calls(message):
        function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
        parts.append(
            gemini_types.Part.from_function_call(
                name=str(function.get("name") or ""),
                args=_parse_tool_arguments(function.get("arguments")),
            )
        )
    if not parts:
        return 0

    contents = [gemini_types.Content(role=role, parts=parts)]
    return await count_tokens_gemini_contents(
        contents,
        model=model,
        api_key=api_key,
        base_url=base_url,
    )


async def count_message_tokens(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    model: str,
    message: dict[str, Any],
    tokenizer_override: str | None = None,
    allow_custom_base_url: bool = True,
) -> int:
    provider_name = _normalize_provider(provider)
    tokenizer = resolve_tokenizer(provider_name, tokenizer_override)
    safe_model = str(model or "").strip()

    primary_error: Exception | None = None

    if tokenizer == "openai":
        return int(count_openai_message_tokens(safe_model, message))

    if tokenizer == "claude":
        try:
            return int(
                await count_claude_message_tokens(
                    db,
                    user_id=user_id,
                    model=safe_model,
                    message=message,
                    allow_custom_base_url=allow_custom_base_url,
                )
            )
        except Exception as exc:
            primary_error = exc

    if tokenizer == "gemini":
        try:
            return int(
                await count_gemini_message_tokens(
                    db,
                    user_id=user_id,
                    model=safe_model,
                    message=message,
                    allow_custom_base_url=allow_custom_base_url,
                )
            )
        except Exception as exc:
            primary_error = exc

    try:
        return int(count_openai_message_tokens(safe_model, message))
    except Exception as fallback_exc:
        if primary_error is not None:
            raise RuntimeError(
                f"Token counting failed (primary={tokenizer}, provider={provider_name}): {primary_error}; "
                f"tiktoken fallback failed: {fallback_exc}"
            ) from fallback_exc
        raise RuntimeError(f"Token counting failed with unknown error; tiktoken fallback failed: {fallback_exc}") from fallback_exc


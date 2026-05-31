"""Single token counting entrypoint used by pipeline and API routes."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session

from ..providers.registry import resolve_llm_tokenizer
from ..providers.shared.parsing.multimodal import (
    _format_text_file,
    _load_text_part,
    build_claude_content,
    build_gemini_binary_parts,
    get_canonical_content_parts,
)
from ..providers.shared.parsing.tool_call_arguments import parse_tool_call_arguments
from .chat_attachment_service import chat_attachment_service
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

try:
    from PIL import Image
except Exception:  # pragma: no cover - Pillow is expected in runtime, but keep fail-open.
    Image = None

from pypdf import PdfReader


TokenizerName = Literal["openai", "claude", "gemini"]
CountMethod = Literal["tiktoken", "claude_api", "gemini_api"]
TokenCountCache = dict[str, Any]

OPENAI_TILE_BASE_TOKENS = 70
OPENAI_TILE_PER_TILE_TOKENS = 140
OPENAI_TILE_MAX_SIDE = 2048.0
OPENAI_TILE_TARGET_SHORT_SIDE = 768.0
OPENAI_TILE_SIZE = 512.0
OPENAI_IMAGE_FALLBACK_DIMENSION = 768.0
OPENAI_PDF_FALLBACK_WIDTH = 612.0
OPENAI_PDF_FALLBACK_HEIGHT = 792.0


@dataclass(frozen=True)
class TokenCountResult:
    token_count: int
    provider: str
    model: str
    effective_tokenizer: TokenizerName
    is_estimate: bool
    fallback_used: bool
    method: CountMethod


_TIKTOKEN_ENCODERS: dict[str, Any] = {}


def _normalize_provider_id(provider: str) -> str:
    normalized = str(provider or "").strip().lower()
    if not normalized:
        raise ValueError("provider is required")
    return normalized


def _normalize_tokenizer_override(tokenizer_override: str | None) -> TokenizerName | None:
    if tokenizer_override is None:
        return None
    normalized = str(tokenizer_override).strip().lower()
    if normalized in {"openai", "claude", "gemini"}:
        return normalized  # type: ignore[return-value]
    return None


def resolve_tokenizer(
    provider: str,
    tokenizer_override: str | None = None,
    *,
    task_config: dict[str, Any] | None = None,
    variant_hint: str | None = None
) -> TokenizerName:
    override = _normalize_tokenizer_override(tokenizer_override)
    if override is not None:
        return override

    provider_name = _normalize_provider_id(provider)
    return resolve_llm_tokenizer(provider_name, task_config=task_config, variant_hint=variant_hint)


def _encoding_for_model(model: str) -> str:
    lower_model = str(model or "").lower()
    if "gpt-4o" in lower_model or "gpt-5" in lower_model or "o1" in lower_model or "o3" in lower_model:
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
    variant_hint: str | None = None,
    allow_custom_base_url: bool = True,
) -> TokenCountResult:
    provider_name = _normalize_provider_id(provider)
    tokenizer = resolve_tokenizer(provider_name, tokenizer_override, variant_hint=variant_hint)
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


def _compact_tool_results(message: dict[str, Any]) -> list[dict[str, Any]]:
    tool_results = message.get("tool_results")
    if not isinstance(tool_results, list):
        return []
    compact: list[dict[str, Any]] = []
    for result in tool_results:
        if not isinstance(result, dict):
            continue
        compact.append(
            {
                "tool_call_id": str(result.get("tool_call_id") or ""),
                "tool_name": str(result.get("tool_name") or ""),
                "content": str(result.get("content") or ""),
            }
        )
    return compact


def _parse_tool_arguments(raw: Any) -> dict[str, Any]:
    return parse_tool_call_arguments(raw)[1]


def _cache_bucket(cache: TokenCountCache | None, key: str) -> dict[str, Any]:
    if cache is None:
        return {}
    bucket = cache.get(key)
    if isinstance(bucket, dict):
        return bucket
    bucket = {}
    cache[key] = bucket
    return bucket


def _coerce_positive_float(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric <= 0:
        return None
    return numeric


def _estimate_openai_visual_tokens(width: float, height: float) -> int:
    safe_width = max(width, 1.0)
    safe_height = max(height, 1.0)
    scale1 = min(1.0, OPENAI_TILE_MAX_SIDE / max(safe_width, safe_height))
    w1 = safe_width * scale1
    h1 = safe_height * scale1
    scale2 = OPENAI_TILE_TARGET_SHORT_SIDE / min(w1, h1)
    w2 = w1 * scale2
    h2 = h1 * scale2
    tiles = math.ceil(w2 / OPENAI_TILE_SIZE) * math.ceil(h2 / OPENAI_TILE_SIZE)
    return OPENAI_TILE_BASE_TOKENS + OPENAI_TILE_PER_TILE_TOKENS * tiles


def _load_attachment_bytes(storage_key: str, cache: TokenCountCache | None = None) -> bytes:
    bucket = _cache_bucket(cache, "attachment_bytes")
    cached = bucket.get(storage_key)
    if isinstance(cached, bytes):
        return cached
    data = chat_attachment_service.load_attachment_bytes(storage_key)
    if cache is not None:
        bucket[storage_key] = data
    return data


def _resolve_image_dimensions(part: dict[str, Any], cache: TokenCountCache | None = None) -> tuple[float, float]:
    width = _coerce_positive_float(part.get("width"))
    height = _coerce_positive_float(part.get("height"))
    if width is not None and height is not None:
        return width, height

    storage_key = str(part.get("storage_key") or "").strip()
    bucket = _cache_bucket(cache, "image_dimensions")
    cached = bucket.get(storage_key) if storage_key else None
    if (
        isinstance(cached, tuple)
        and len(cached) == 2
        and _coerce_positive_float(cached[0]) is not None
        and _coerce_positive_float(cached[1]) is not None
    ):
        return float(cached[0]), float(cached[1])

    if storage_key and Image is not None:
        try:
            data = _load_attachment_bytes(storage_key, cache)
            with Image.open(BytesIO(data)) as image:
                image.load()
                resolved = (float(image.size[0]), float(image.size[1]))
                if cache is not None:
                    bucket[storage_key] = resolved
                return resolved
        except Exception:
            pass

    resolved = (OPENAI_IMAGE_FALLBACK_DIMENSION, OPENAI_IMAGE_FALLBACK_DIMENSION)
    if storage_key and cache is not None:
        bucket[storage_key] = resolved
    return resolved


def _estimate_openai_pdf_tokens(part: dict[str, Any], model: str, cache: TokenCountCache | None = None) -> int:
    storage_key = str(part.get("storage_key") or "").strip()
    cache_key = f"{storage_key}:{model}"
    bucket = _cache_bucket(cache, "openai_pdf_tokens")
    cached = bucket.get(cache_key)
    if isinstance(cached, int):
        return cached

    default_total = _estimate_openai_visual_tokens(OPENAI_PDF_FALLBACK_WIDTH, OPENAI_PDF_FALLBACK_HEIGHT)
    if not storage_key:
        return default_total

    try:
        data = _load_attachment_bytes(storage_key, cache)
        reader = PdfReader(BytesIO(data))
        pages = list(reader.pages)
        if not pages:
            total = default_total
        else:
            page_visual_tokens = 0
            text_chunks: list[str] = []
            for page in pages:
                try:
                    extracted_text = page.extract_text() or ""
                except Exception:
                    extracted_text = ""
                if extracted_text.strip():
                    text_chunks.append(extracted_text)

                media_box = getattr(page, "mediabox", None)
                width = _coerce_positive_float(getattr(media_box, "width", None)) or OPENAI_PDF_FALLBACK_WIDTH
                height = _coerce_positive_float(getattr(media_box, "height", None)) or OPENAI_PDF_FALLBACK_HEIGHT
                page_visual_tokens += _estimate_openai_visual_tokens(width, height)

            pdf_text_tokens = _count_tokens_tiktoken("\n\n".join(text_chunks), model) if text_chunks else 0
            total = page_visual_tokens + pdf_text_tokens
    except Exception:
        total = default_total

    if cache is not None:
        bucket[cache_key] = total
    return total


def _estimate_openai_text_file_tokens(part: dict[str, Any], model: str, cache: TokenCountCache | None = None) -> int:
    storage_key = str(part.get("storage_key") or "").strip()
    filename = str(part.get("filename") or "").strip() or "attachment"
    mime_type = str(part.get("mime_type") or "").strip()
    cache_key = f"{storage_key}:{model}"
    bucket = _cache_bucket(cache, "openai_text_file_tokens")
    cached = bucket.get(cache_key)
    if isinstance(cached, int):
        return cached

    try:
        text = _load_text_part(part)
    except Exception:
        text = ""

    total = _count_tokens_tiktoken(_format_text_file(filename, mime_type, text), model)
    if cache is not None:
        bucket[cache_key] = total
    return total


def _openai_attachment_tokens_for_parts(
    parts: list[dict[str, Any]],
    model: str,
    cache: TokenCountCache | None = None,
) -> int:
    total = 0
    for part in parts:
        if not isinstance(part, dict):
            continue
        part_type = str(part.get("type") or "")
        if part_type == "image":
            width, height = _resolve_image_dimensions(part, cache)
            total += _estimate_openai_visual_tokens(width, height)
        elif part_type == "file":
            total += _estimate_openai_pdf_tokens(part, model, cache)
        elif part_type == "text_file":
            total += _estimate_openai_text_file_tokens(part, model, cache)
    return total


def _openai_message_payload_text(message: dict[str, Any]) -> str:
    payload = {
        "role": str(message.get("role") or ""),
        "content": _content_text(message),
        "tool_calls": _compact_tool_calls(message),
        "tool_results": _compact_tool_results(message),
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def count_openai_message_tokens(
    model: str,
    message: dict[str, Any],
    cache: TokenCountCache | None = None,
) -> int:
    text_tokens = _count_tokens_tiktoken(_openai_message_payload_text(message), model)
    parts = get_canonical_content_parts(message)
    attachment_tokens = _openai_attachment_tokens_for_parts(parts, model, cache)
    return text_tokens + attachment_tokens


def _resolve_system_prompt(system_prompt: str, conversation: list[dict[str, Any]]) -> str | None:
    chunks: list[str] = []
    if isinstance(system_prompt, str) and system_prompt.strip():
        chunks.append(system_prompt)
    for message in conversation:
        if str(message.get("role") or "") != "system":
            continue
        text = _content_text(message).strip()
        if text:
            chunks.append(text)
    if not chunks:
        return None
    return "\n\n".join(chunks)


def _build_claude_message(message: dict[str, Any]) -> dict[str, Any] | None:
    role = str(message.get("role") or "user")
    if role == "system":
        return None
    if role == "tool_results":
        content_blocks = []
        for tool_result in _compact_tool_results(message):
            content_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_result.get("tool_call_id", ""),
                    "content": tool_result.get("content", ""),
                }
            )
        if not content_blocks:
            return None
        return {"role": "user", "content": content_blocks}

    canonical_parts = get_canonical_content_parts(message)
    content_blocks = build_claude_content(canonical_parts)
    if role == "assistant":
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
        return None
    mapped_role = "assistant" if role == "assistant" else "user"
    return {"role": mapped_role, "content": content_blocks}


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

    claude_message = _build_claude_message(message)
    if claude_message is None:
        return 0

    return await count_tokens_claude_messages(
        [claude_message],
        model=model,
        api_key=api_key,
        base_url=base_url,
    )


async def count_claude_conversation_tokens(
    db: Session,
    *,
    user_id: UUID,
    model: str,
    system_prompt: str,
    conversation: list[dict[str, Any]],
    allow_custom_base_url: bool = True,
) -> int:
    provider_config = credential_service.get_provider_config(db, user_id, "claude")
    api_key = _extract_api_key(provider_config)
    if not api_key:
        raise CredentialServiceError("Credential for provider 'claude' not found")
    base_url_raw = provider_config.get("base_url") if allow_custom_base_url else None
    base_url = str(base_url_raw).strip() if isinstance(base_url_raw, str) and base_url_raw.strip() else None

    claude_messages = [
        built
        for message in conversation
        if (built := _build_claude_message(message)) is not None
    ]
    if not claude_messages and not (system_prompt or "").strip():
        return 0

    return await count_tokens_claude_messages(
        claude_messages,
        model=model,
        api_key=api_key,
        base_url=base_url,
        system=_resolve_system_prompt(system_prompt, conversation),
    )


def _build_gemini_content(message: dict[str, Any]) -> Any | None:
    from google.genai import types as gemini_types

    role = str(message.get("role") or "user")
    if role == "system":
        return None
    if role == "tool_results":
        parts = []
        for tool_result in _compact_tool_results(message):
            parts.append(
                gemini_types.Part.from_function_response(
                    name=tool_result.get("tool_name", ""),
                    response={"result": tool_result.get("content", "")},
                )
            )
        if not parts:
            return None
        return gemini_types.Content(role="user", parts=parts)

    parts: list[Any] = []
    for part in build_gemini_binary_parts(get_canonical_content_parts(message)):
        if part.get("type") == "text":
            parts.append(gemini_types.Part.from_text(text=str(part.get("text") or "")))
        elif part.get("type") == "binary":
            parts.append(
                gemini_types.Part.from_bytes(
                    data=part.get("data"),
                    mime_type=str(part.get("mime_type") or ""),
                )
            )

    if role == "assistant":
        for tool_call in _compact_tool_calls(message):
            function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
            parts.append(
                gemini_types.Part.from_function_call(
                    name=str(function.get("name") or ""),
                    args=_parse_tool_arguments(function.get("arguments")),
                )
            )

    if not parts:
        return None

    mapped_role = "model" if role == "assistant" else "user"
    return gemini_types.Content(role=mapped_role, parts=parts)


def _gemini_count_config(system_prompt: str, conversation: list[dict[str, Any]]) -> Any | None:
    from google.genai import types as gemini_types

    merged_system_prompt = _resolve_system_prompt(system_prompt, conversation)
    if not merged_system_prompt:
        return None
    return gemini_types.CountTokensConfig(system_instruction=merged_system_prompt)


async def count_gemini_message_tokens(
    db: Session,
    *,
    user_id: UUID,
    model: str,
    message: dict[str, Any],
    allow_custom_base_url: bool = True,
) -> int:
    provider_config = credential_service.get_provider_config(db, user_id, "gemini")
    api_key = _extract_api_key(provider_config)
    if not api_key:
        raise CredentialServiceError("Credential for provider 'gemini' not found")
    base_url_raw = provider_config.get("base_url") if allow_custom_base_url else None
    base_url = str(base_url_raw).strip() if isinstance(base_url_raw, str) and base_url_raw.strip() else None

    content = _build_gemini_content(message)
    if content is None:
        return 0

    return await count_tokens_gemini_contents(
        [content],
        model=model,
        api_key=api_key,
        base_url=base_url,
    )


async def count_gemini_conversation_tokens(
    db: Session,
    *,
    user_id: UUID,
    model: str,
    system_prompt: str,
    conversation: list[dict[str, Any]],
    allow_custom_base_url: bool = True,
) -> int:
    provider_config = credential_service.get_provider_config(db, user_id, "gemini")
    api_key = _extract_api_key(provider_config)
    if not api_key:
        raise CredentialServiceError("Credential for provider 'gemini' not found")
    base_url_raw = provider_config.get("base_url") if allow_custom_base_url else None
    base_url = str(base_url_raw).strip() if isinstance(base_url_raw, str) and base_url_raw.strip() else None

    contents = [
        built
        for message in conversation
        if (built := _build_gemini_content(message)) is not None
    ]
    config = _gemini_count_config(system_prompt, conversation)
    if not contents and config is None:
        return 0

    return await count_tokens_gemini_contents(
        contents,
        model=model,
        api_key=api_key,
        base_url=base_url,
        config=config,
    )


async def count_message_tokens(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    model: str,
    message: dict[str, Any],
    tokenizer_override: str | None = None,
    variant_hint: str | None = None,
    allow_custom_base_url: bool = True,
    cache: TokenCountCache | None = None,
) -> int:
    provider_name = _normalize_provider_id(provider)
    tokenizer = resolve_tokenizer(provider_name, tokenizer_override, variant_hint=variant_hint)
    safe_model = str(model or "").strip()

    primary_error: Exception | None = None

    if tokenizer == "openai":
        return int(count_openai_message_tokens(safe_model, message, cache))

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
        return int(count_openai_message_tokens(safe_model, message, cache))
    except Exception as fallback_exc:
        if primary_error is not None:
            raise RuntimeError(
                f"Token counting failed (primary={tokenizer}, provider={provider_name}): {primary_error}; "
                f"tiktoken fallback failed: {fallback_exc}"
            ) from fallback_exc
        raise RuntimeError(f"Token counting failed with unknown error; tiktoken fallback failed: {fallback_exc}") from fallback_exc


async def count_conversation_tokens(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    model: str,
    system_prompt: str,
    conversation: list[dict[str, Any]],
    tokenizer_override: str | None = None,
    variant_hint: str | None = None,
    allow_custom_base_url: bool = True,
    cache: TokenCountCache | None = None,
) -> int:
    provider_name = _normalize_provider_id(provider)
    tokenizer = resolve_tokenizer(provider_name, tokenizer_override, variant_hint=variant_hint)
    safe_model = str(model or "").strip()

    primary_error: Exception | None = None

    if tokenizer == "openai":
        total = 0
        if isinstance(system_prompt, str) and system_prompt.strip():
            total += count_openai_message_tokens(
                safe_model,
                {"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]},
                cache,
            )
        for message in conversation:
            if str(message.get("role") or "") == "system":
                continue
            total += count_openai_message_tokens(safe_model, message, cache)
        return total

    if tokenizer == "claude":
        try:
            return int(
                await count_claude_conversation_tokens(
                    db,
                    user_id=user_id,
                    model=safe_model,
                    system_prompt=system_prompt,
                    conversation=conversation,
                    allow_custom_base_url=allow_custom_base_url,
                )
            )
        except Exception as exc:
            primary_error = exc

    if tokenizer == "gemini":
        try:
            return int(
                await count_gemini_conversation_tokens(
                    db,
                    user_id=user_id,
                    model=safe_model,
                    system_prompt=system_prompt,
                    conversation=conversation,
                    allow_custom_base_url=allow_custom_base_url,
                )
            )
        except Exception as exc:
            primary_error = exc

    try:
        total = 0
        if isinstance(system_prompt, str) and system_prompt.strip():
            total += count_openai_message_tokens(
                safe_model,
                {"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]},
                cache,
            )
        for message in conversation:
            if str(message.get("role") or "") == "system":
                continue
            total += count_openai_message_tokens(safe_model, message, cache)
        return int(total)
    except Exception as fallback_exc:
        if primary_error is not None:
            raise RuntimeError(
                f"Conversation token counting failed (primary={tokenizer}, provider={provider_name}): {primary_error}; "
                f"tiktoken fallback failed: {fallback_exc}"
            ) from fallback_exc
        raise RuntimeError(
            f"Conversation token counting failed with unknown error; tiktoken fallback failed: {fallback_exc}"
        ) from fallback_exc

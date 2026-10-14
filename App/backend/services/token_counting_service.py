"""Token counting service for Claude and Gemini providers.

Provides async functions to count tokens using each provider's native API.
"""

from __future__ import annotations

from typing import Any, Optional

from anthropic import AsyncAnthropic
from google import genai
from google.genai import types

from ..providers.registry import create_llm_provider
from ..providers.shared.base import BaseProvider
from ..utils.outbound_http import validate_outbound_base_url


def _build_claude_client(api_key: str, base_url: str | None = None) -> AsyncAnthropic:
    kwargs: dict[str, Any] = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = validate_outbound_base_url(base_url)
    return AsyncAnthropic(**kwargs)


async def count_tokens_claude(
    text: str,
    model: str,
    api_key: str,
    base_url: Optional[str] = None,
) -> int:
    """Count tokens for Claude models using the Anthropic API."""
    client = _build_claude_client(api_key, base_url)
    try:
        result = await client.messages.count_tokens(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": text,
                }
            ],
        )
        return result.input_tokens
    finally:
        await BaseProvider._close_sdk_client(client)


async def count_tokens_claude_messages(
    messages: list[dict[str, Any]],
    model: str,
    api_key: str,
    base_url: Optional[str] = None,
    system: str | None = None,
) -> int:
    """Count tokens for Claude models using native Anthropic message blocks."""
    client = _build_claude_client(api_key, base_url)
    try:
        result = await client.messages.count_tokens(
            model=model,
            messages=messages,
            **({"system": system} if isinstance(system, str) and system.strip() else {}),
        )
        return int(result.input_tokens)
    finally:
        await BaseProvider._close_sdk_client(client)


async def count_tokens_gemini(
    text: str,
    model: str,
    api_key: str | None = None,
    base_url: Optional[str] = None,
    *,
    provider: str = "gemini",
    provider_config: dict[str, Any] | None = None,
) -> int:
    """Count tokens for Gemini models using the Google GenAI API."""
    return await count_tokens_gemini_contents(
        text,
        model=model,
        api_key=api_key,
        base_url=base_url,
        provider=provider,
        provider_config=provider_config,
    )


async def count_tokens_gemini_contents(
    contents: Any,
    model: str,
    api_key: str | None = None,
    base_url: Optional[str] = None,
    config: Any = None,
    *,
    provider: str = "gemini",
    provider_config: dict[str, Any] | None = None,
) -> int:
    """Count tokens for Gemini models with native contents payload."""
    runtime = None
    if provider == "gemini":
        http_options = None
        if base_url:
            http_options = types.HttpOptions(baseUrl=validate_outbound_base_url(base_url))
        client = genai.Client(enterprise=False, api_key=api_key, http_options=http_options)
    else:
        runtime = create_llm_provider(provider, provider_config or {})
        if not runtime.validate_config():
            raise ValueError(f"Invalid configuration for provider '{provider}'")
        client = runtime._ensure_client()
    try:
        result = await client.aio.models.count_tokens(
            model=model,
            contents=contents,
            **({"config": config} if config is not None else {}),
        )
        return int(result.total_tokens)
    finally:
        if runtime is not None:
            await runtime.aclose()
        else:
            await BaseProvider._close_sdk_client(client.aio)
            await BaseProvider._close_sdk_client(client)


__all__ = [
    "count_tokens_claude",
    "count_tokens_claude_messages",
    "count_tokens_gemini",
    "count_tokens_gemini_contents",
]

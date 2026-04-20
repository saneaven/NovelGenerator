"""Token counting service for Claude and Gemini providers.

Provides async functions to count tokens using each provider's native API.
"""

from __future__ import annotations

from typing import Any, Optional

from anthropic import AsyncAnthropic
from google import genai
from google.genai import types

from ..providers.base import BaseProvider
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
    api_key: str,
    base_url: Optional[str] = None,
) -> int:
    """Count tokens for Gemini models using the Google GenAI API."""
    http_options = None
    if base_url:
        http_options = types.HttpOptions(baseUrl=validate_outbound_base_url(base_url))

    client = genai.Client(api_key=api_key, http_options=http_options)
    try:
        result = client.models.count_tokens(
            model=model,
            contents=text,
        )
        return result.total_tokens
    finally:
        await BaseProvider._close_sdk_client(client)


async def count_tokens_gemini_contents(
    contents: Any,
    model: str,
    api_key: str,
    base_url: Optional[str] = None,
    config: Any = None,
) -> int:
    """Count tokens for Gemini models with native contents payload."""
    http_options = None
    if base_url:
        http_options = types.HttpOptions(baseUrl=validate_outbound_base_url(base_url))

    client = genai.Client(api_key=api_key, http_options=http_options)
    try:
        result = client.models.count_tokens(
            model=model,
            contents=contents,
            **({"config": config} if config is not None else {}),
        )
        return int(result.total_tokens)
    finally:
        await BaseProvider._close_sdk_client(client)


__all__ = [
    "count_tokens_claude",
    "count_tokens_claude_messages",
    "count_tokens_gemini",
    "count_tokens_gemini_contents",
]

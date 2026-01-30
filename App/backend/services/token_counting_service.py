"""Token counting service for Claude and Gemini providers.

Provides async functions to count tokens using each provider's native API.
"""

from __future__ import annotations

from typing import Optional

from anthropic import AsyncAnthropic
from google import genai
from google.genai import types

from ..utils.outbound_http import validate_outbound_base_url


async def count_tokens_claude(
    text: str,
    model: str,
    api_key: str,
    base_url: Optional[str] = None,
) -> int:
    """Count tokens for Claude models using the Anthropic API.

    Args:
        text: The text to count tokens for.
        model: The Claude model name (e.g., 'claude-3-opus-20240229').
        api_key: Anthropic API key.
        base_url: Optional custom base URL.

    Returns:
        Number of input tokens.
    """
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = validate_outbound_base_url(base_url)

    client = AsyncAnthropic(**kwargs)

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
        await client.close()


async def count_tokens_gemini(
    text: str,
    model: str,
    api_key: str,
    base_url: Optional[str] = None,
) -> int:
    """Count tokens for Gemini models using the Google GenAI API.

    Args:
        text: The text to count tokens for.
        model: The Gemini model name (e.g., 'gemini-2.0-flash').
        api_key: Google API key.
        base_url: Optional custom base URL.

    Returns:
        Number of tokens.
    """
    http_options = None
    if base_url:
        http_options = types.HttpOptions(baseUrl=validate_outbound_base_url(base_url))

    client = genai.Client(api_key=api_key, http_options=http_options)

    result = client.models.count_tokens(
        model=model,
        contents=text,
    )

    return result.total_tokens


__all__ = ["count_tokens_claude", "count_tokens_gemini"]

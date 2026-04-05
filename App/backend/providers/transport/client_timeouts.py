from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import httpx

# Reserved for the future single-env-var configuration path.
LLM_STREAM_TIMEOUT_ENV_VAR = "LLM_STREAM_TIMEOUT_SECONDS"

_DEFAULT_LLM_STREAM_TIMEOUT_SECONDS = 3600.0
_DEFAULT_LLM_STREAM_CONNECT_TIMEOUT_SECONDS = 5.0


def get_llm_stream_timeout() -> "httpx.Timeout":
    """Return the default timeout for OpenAI/Anthropic-family streaming clients."""
    import httpx

    return httpx.Timeout(
        timeout=_DEFAULT_LLM_STREAM_TIMEOUT_SECONDS,
        connect=_DEFAULT_LLM_STREAM_CONNECT_TIMEOUT_SECONDS,
    )

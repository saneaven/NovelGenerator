from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import httpx

LLM_STREAM_TIMEOUT_ENV_VAR = "LLM_STREAM_TIMEOUT_SECONDS"
LLM_STREAM_CONNECT_TIMEOUT_ENV_VAR = "LLM_STREAM_CONNECT_TIMEOUT_SECONDS"

_DEFAULT_LLM_STREAM_TIMEOUT_SECONDS = 3600.0
# A connect deadline is measured by the event loop, so a loop stalled by another
# run's setup work makes a healthy connection look like a timeout. Keep it well
# above the worst-case stall.
_DEFAULT_LLM_STREAM_CONNECT_TIMEOUT_SECONDS = 30.0


def _read_timeout_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def get_llm_stream_timeout() -> "httpx.Timeout":
    """Return the default timeout for OpenAI/Anthropic-family streaming clients."""
    import httpx

    return httpx.Timeout(
        timeout=_read_timeout_env(LLM_STREAM_TIMEOUT_ENV_VAR, _DEFAULT_LLM_STREAM_TIMEOUT_SECONDS),
        connect=_read_timeout_env(
            LLM_STREAM_CONNECT_TIMEOUT_ENV_VAR, _DEFAULT_LLM_STREAM_CONNECT_TIMEOUT_SECONDS
        ),
    )

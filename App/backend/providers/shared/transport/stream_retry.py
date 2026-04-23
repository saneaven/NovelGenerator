"""Transparent retry wrapper for provider streams.

Wraps a provider's ``stream_chat`` async generator so that transient,
retryable errors (e.g. 429 rate-limit, 502 bad gateway) are automatically
retried up to ``max_retries`` times — but **only** when no content has been
yielded yet.  Once any delta with meaningful content is emitted, the stream
is considered non-retryable and errors pass through immediately.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Awaitable, Callable, Optional

from ..contracts import DeltaPayload, ProviderErrorPayload, ProviderEvent

logger = logging.getLogger(__name__)


@dataclass
class NormalizedRetryConfig:
    max_retries: int
    retryable_status_codes: set[int]
    retry_delay_ms: int


def normalize_retry_config(raw: dict[str, Any] | None) -> NormalizedRetryConfig | None:
    """Normalize a retry config dict into a ``NormalizedRetryConfig``.

    Accepts both camelCase keys (from ``settings_service.get_retry_config``)
    and snake_case keys (from ``request.retry_config.model_dump()``).
    Returns ``None`` when retry is disabled or *raw* is falsy.
    """
    if not raw:
        return None

    if not raw.get("enabled", True):
        return None

    max_retries = raw.get("maxRetries") or raw.get("max_retries") or 0
    if int(max_retries) <= 0:
        return None

    codes = raw.get("retryableStatusCodes") or raw.get("retryable_status_codes") or []
    delay = raw.get("retryDelayMs") or raw.get("retry_delay_ms") or 1000

    return NormalizedRetryConfig(
        max_retries=int(max_retries),
        retryable_status_codes=set(codes),
        retry_delay_ms=int(delay),
    )


def _has_content(delta: Optional[DeltaPayload]) -> bool:
    """Return True if *delta* carries any user-visible content."""
    if delta is None:
        return False
    return bool(
        delta.content_delta
        or delta.thinking_delta
        or delta.tool_call_deltas
        or delta.reasoning_detail_delta
    )


async def stream_with_retry(
    stream_factory: Callable[[], AsyncGenerator[ProviderEvent, None]],
    retry_config: NormalizedRetryConfig | None,
    on_retry: Callable[[str, int | None, int], Awaitable[None]] | None = None,
) -> AsyncGenerator[ProviderEvent, None]:
    """Wrap a provider stream with automatic retry on transient errors.

    Parameters
    ----------
    stream_factory:
        A zero-argument callable that creates a **fresh** provider stream
        (i.e. calls ``provider.stream_chat(...)``).
    retry_config:
        Normalized retry settings, or ``None`` to disable retry entirely.
    """

    # Fast path: no retry configured — just yield events from a single stream.
    if retry_config is None:
        async for event in stream_factory():
            yield event
        return

    attempt = 0
    while True:
        content_yielded = False
        should_retry = False
        stream = stream_factory()

        try:
            async for event in stream:
                if event.kind == "delta" and _has_content(event.delta):
                    content_yielded = True

                if event.kind == "error":
                    error = event.error or ProviderErrorPayload(message="Unknown error", status=None)

                    if (
                        not content_yielded
                        and attempt < retry_config.max_retries
                        and error.status is not None
                        and error.status in retry_config.retryable_status_codes
                    ):
                        attempt += 1
                        logger.warning(
                            "Retryable error (status=%s, attempt %d/%d): %s",
                            error.status,
                            attempt,
                            retry_config.max_retries,
                            error.message,
                        )
                        if on_retry is not None:
                            await on_retry(error.message, error.status, attempt)
                        should_retry = True
                        break  # break inner loop to retry

                    # Not retryable — pass through.
                    yield event
                    return

                yield event
            else:
                # Stream completed normally (for/else: no break).
                return
        finally:
            if hasattr(stream, "aclose"):
                await stream.aclose()

        if should_retry:
            delay_s = retry_config.retry_delay_ms / 1000.0
            await asyncio.sleep(delay_s)

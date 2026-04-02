"""Tests for providers.stream_retry module."""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

from App.backend.providers.contracts import DeltaPayload, ProviderErrorPayload, ProviderEvent
from App.backend.providers.stream_retry import (
    NormalizedRetryConfig,
    normalize_retry_config,
    stream_with_retry,
)

SLEEP_TARGET = "App.backend.providers.stream_retry.asyncio.sleep"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _delta_event(content: str = "hello") -> ProviderEvent:
    return ProviderEvent(kind="delta", delta=DeltaPayload(content_delta=content))


def _thinking_event(text: str = "thinking...") -> ProviderEvent:
    return ProviderEvent(kind="delta", delta=DeltaPayload(thinking_delta=text))


def _meta_event() -> ProviderEvent:
    return ProviderEvent(kind="meta")


def _error_event(status: int | None = 429, message: str = "rate limited") -> ProviderEvent:
    return ProviderEvent(kind="error", error=ProviderErrorPayload(message=message, status=status))


def _make_factory(events_per_attempt: list[list[ProviderEvent]]):
    """Return a factory that yields different events on each call."""
    call_count = 0

    def factory() -> AsyncGenerator[ProviderEvent, None]:
        nonlocal call_count
        idx = min(call_count, len(events_per_attempt) - 1)
        call_count += 1

        async def _gen():
            for e in events_per_attempt[idx]:
                yield e

        return _gen()

    return factory


DEFAULT_CFG = NormalizedRetryConfig(
    max_retries=3,
    retryable_status_codes={429, 500, 502, 503, 504},
    retry_delay_ms=100,
)


async def _collect(stream: AsyncGenerator[ProviderEvent, None]) -> list[ProviderEvent]:
    out = []
    async for e in stream:
        out.append(e)
    return out


# ---------------------------------------------------------------------------
# normalize_retry_config
# ---------------------------------------------------------------------------

class TestNormalizeRetryConfig:
    def test_camel_case(self):
        raw = {
            "enabled": True,
            "maxRetries": 5,
            "retryableStatusCodes": [429, 500],
            "retryDelayMs": 2000,
        }
        cfg = normalize_retry_config(raw)
        assert cfg is not None
        assert cfg.max_retries == 5
        assert cfg.retryable_status_codes == {429, 500}
        assert cfg.retry_delay_ms == 2000

    def test_snake_case(self):
        raw = {
            "enabled": True,
            "max_retries": 2,
            "retryable_status_codes": [502, 503],
            "retry_delay_ms": 500,
        }
        cfg = normalize_retry_config(raw)
        assert cfg is not None
        assert cfg.max_retries == 2
        assert cfg.retryable_status_codes == {502, 503}
        assert cfg.retry_delay_ms == 500

    def test_disabled(self):
        raw = {"enabled": False, "maxRetries": 3}
        assert normalize_retry_config(raw) is None

    def test_none_input(self):
        assert normalize_retry_config(None) is None

    def test_empty_dict(self):
        assert normalize_retry_config({}) is None

    def test_zero_max_retries(self):
        raw = {"enabled": True, "maxRetries": 0}
        assert normalize_retry_config(raw) is None


# ---------------------------------------------------------------------------
# stream_with_retry
# ---------------------------------------------------------------------------

class TestStreamWithRetry:
    def test_passthrough_no_config(self):
        """When retry_config is None, events pass through unmodified."""
        events = [_delta_event("hi"), _meta_event()]
        factory = _make_factory([events])

        async def _run():
            return await _collect(stream_with_retry(factory, None))

        result = asyncio.run(_run())
        assert len(result) == 2
        assert result[0].delta.content_delta == "hi"

    def test_passthrough_on_success(self):
        """Successful stream with retry config: all events pass through."""
        events = [_meta_event(), _delta_event("ok"), _meta_event()]
        factory = _make_factory([events])

        async def _run():
            return await _collect(stream_with_retry(factory, DEFAULT_CFG))

        result = asyncio.run(_run())
        assert len(result) == 3

    def test_retry_on_retryable_error_before_content(self):
        """429 error before content triggers retry; second attempt succeeds."""
        attempt_1 = [_meta_event(), _error_event(429)]
        attempt_2 = [_delta_event("success"), _meta_event()]
        factory = _make_factory([attempt_1, attempt_2])

        async def _run():
            with patch(SLEEP_TARGET, new_callable=AsyncMock) as mock_sleep:
                result = await _collect(stream_with_retry(factory, DEFAULT_CFG))
            return result, mock_sleep

        result, mock_sleep = asyncio.run(_run())
        assert any(e.kind == "delta" and e.delta.content_delta == "success" for e in result)
        mock_sleep.assert_called_once_with(0.1)  # 100ms

    def test_no_retry_after_content_delta(self):
        """Error after content was yielded passes through (no retry)."""
        events = [_delta_event("partial"), _error_event(429)]
        factory = _make_factory([events])

        async def _run():
            with patch(SLEEP_TARGET, new_callable=AsyncMock) as mock_sleep:
                result = await _collect(stream_with_retry(factory, DEFAULT_CFG))
            return result, mock_sleep

        result, mock_sleep = asyncio.run(_run())
        mock_sleep.assert_not_called()
        assert result[-1].kind == "error"

    def test_no_retry_after_thinking_delta(self):
        """Error after thinking delta passes through (no retry)."""
        events = [_thinking_event(), _error_event(429)]
        factory = _make_factory([events])

        async def _run():
            with patch(SLEEP_TARGET, new_callable=AsyncMock) as mock_sleep:
                result = await _collect(stream_with_retry(factory, DEFAULT_CFG))
            return result, mock_sleep

        result, mock_sleep = asyncio.run(_run())
        mock_sleep.assert_not_called()
        assert result[-1].kind == "error"

    def test_no_retry_on_non_retryable_status(self):
        """400 error (not in retryable list) passes through."""
        events = [_error_event(400, "bad request")]
        factory = _make_factory([events])

        async def _run():
            with patch(SLEEP_TARGET, new_callable=AsyncMock) as mock_sleep:
                result = await _collect(stream_with_retry(factory, DEFAULT_CFG))
            return result, mock_sleep

        result, mock_sleep = asyncio.run(_run())
        mock_sleep.assert_not_called()
        assert result[0].kind == "error"

    def test_no_retry_on_none_status(self):
        """Error with status=None passes through."""
        events = [_error_event(None, "parse error")]
        factory = _make_factory([events])

        async def _run():
            with patch(SLEEP_TARGET, new_callable=AsyncMock) as mock_sleep:
                result = await _collect(stream_with_retry(factory, DEFAULT_CFG))
            return result, mock_sleep

        result, mock_sleep = asyncio.run(_run())
        mock_sleep.assert_not_called()
        assert result[0].kind == "error"

    def test_max_retries_exhausted(self):
        """After max_retries attempts, the error passes through."""
        error_events = [_error_event(429)]
        cfg = NormalizedRetryConfig(
            max_retries=2,
            retryable_status_codes={429},
            retry_delay_ms=10,
        )
        # 3 attempts total: initial + 2 retries
        factory = _make_factory([error_events, error_events, error_events])

        async def _run():
            with patch(SLEEP_TARGET, new_callable=AsyncMock) as mock_sleep:
                result = await _collect(stream_with_retry(factory, cfg))
            return result, mock_sleep

        result, mock_sleep = asyncio.run(_run())
        assert mock_sleep.call_count == 2
        assert result[-1].kind == "error"

    def test_retry_delay_value(self):
        """Verify asyncio.sleep is called with correct delay in seconds."""
        cfg = NormalizedRetryConfig(
            max_retries=1,
            retryable_status_codes={500},
            retry_delay_ms=2500,
        )
        attempt_1 = [_error_event(500)]
        attempt_2 = [_delta_event("ok")]
        factory = _make_factory([attempt_1, attempt_2])

        async def _run():
            with patch(SLEEP_TARGET, new_callable=AsyncMock) as mock_sleep:
                await _collect(stream_with_retry(factory, cfg))
            return mock_sleep

        mock_sleep = asyncio.run(_run())
        mock_sleep.assert_called_once_with(2.5)

    def test_on_retry_callback_receives_error_details(self):
        attempt_1 = [_error_event(429, "rate limited")]
        attempt_2 = [_delta_event("ok")]
        factory = _make_factory([attempt_1, attempt_2])

        async def _run():
            on_retry = AsyncMock()
            with patch(SLEEP_TARGET, new_callable=AsyncMock):
                await _collect(stream_with_retry(factory, DEFAULT_CFG, on_retry=on_retry))
            return on_retry

        on_retry = asyncio.run(_run())
        on_retry.assert_awaited_once_with("rate limited", 429, 1)

    def test_meta_events_do_not_block_retry(self):
        """Meta and raw_request events are yielded but don't prevent retry."""
        attempt_1 = [_meta_event(), _meta_event(), _error_event(502)]
        attempt_2 = [_delta_event("recovered")]
        factory = _make_factory([attempt_1, attempt_2])

        async def _run():
            with patch(SLEEP_TARGET, new_callable=AsyncMock):
                return await _collect(stream_with_retry(factory, DEFAULT_CFG))

        result = asyncio.run(_run())
        assert any(e.kind == "delta" and e.delta.content_delta == "recovered" for e in result)

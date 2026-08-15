"""Exception description and transport-error classification.

Many transport-level exceptions carry an empty ``str()`` — ``httpx.ConnectTimeout``,
``httpx.ReadTimeout``, ``asyncio.TimeoutError``, ``ConnectionResetError``,
``MemoryError``.  Formatting them with ``str(exc)`` alone erases the only clue the
user would get, so always fall back to the class name.
"""

from __future__ import annotations

import asyncio


# Types the pipeline raises purely to carry an already-formatted message; naming
# them adds noise, not information.
_CARRIER_TYPES = (RuntimeError, Exception)


def describe_exception(exc: BaseException) -> str:
    """Return a user-facing description that never collapses to an empty string."""
    name = type(exc).__name__
    text = str(exc).strip()
    if not text:
        return name
    if text.startswith(name):
        return text
    if type(exc) in _CARRIER_TYPES:
        return text
    return f"{name}: {text}"


def provider_error_fields(exc: BaseException) -> tuple[str, int | None, bool]:
    """Return ``(message, status, retryable)`` for a provider error event."""
    status = (
        getattr(exc, "status_code", None)
        or getattr(exc, "status", None)
        or getattr(exc, "code", None)
    )
    return (
        describe_exception(exc),
        status if isinstance(status, int) else None,
        is_retryable_transport_error(exc),
    )


def is_retryable_transport_error(exc: BaseException) -> bool:
    """Return True for transient connection/timeout failures worth retrying.

    These surface with ``status=None``, so the status-code retry list never
    matches them.
    """
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError, ConnectionError)):
        return True

    try:
        import httpx
    except ImportError:
        return False

    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)):
        return True

    # SDK wrappers (openai/anthropic) keep the transport error on __cause__.
    cause = exc.__cause__
    if cause is not None and cause is not exc:
        return is_retryable_transport_error(cause)
    return False

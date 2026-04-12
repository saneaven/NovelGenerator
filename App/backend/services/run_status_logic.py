from __future__ import annotations

from collections.abc import Iterable


_PENDING_TOOL_STATUSES = {"pending"}
_IN_PROGRESS_TOOL_STATUSES = {"streaming", "validating", "processing", "working"}
_REJECTED_TOOL_STATUSES = {"rejected"}
_READY_TOOL_STATUSES = {"applied", "failed"}
_KNOWN_TOOL_STATUSES = (
    _PENDING_TOOL_STATUSES
    | _IN_PROGRESS_TOOL_STATUSES
    | _REJECTED_TOOL_STATUSES
    | _READY_TOOL_STATUSES
)


def derive_run_status(*, current_status: str | None, tool_call_statuses: Iterable[str]) -> str | None:
    statuses = list(tool_call_statuses)
    unknown_statuses = sorted({status for status in statuses if status not in _KNOWN_TOOL_STATUSES})
    if unknown_statuses:
        joined = ", ".join(repr(status) for status in unknown_statuses)
        raise ValueError(f"Unknown tool call status: {joined}")

    if current_status == "paused":
        return "paused"
    if not statuses:
        return "done"
    if any(status in _PENDING_TOOL_STATUSES for status in statuses):
        return "waiting"
    if any(status in _IN_PROGRESS_TOOL_STATUSES for status in statuses):
        return "processing"
    if any(status in _REJECTED_TOOL_STATUSES for status in statuses):
        return "paused"
    if all(status in _READY_TOOL_STATUSES for status in statuses):
        return "ready"

    # This should be unreachable because unknown statuses are rejected above and
    # every known status family is handled explicitly.
    raise ValueError(f"Unhandled tool call status combination: {statuses!r}")

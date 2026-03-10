from __future__ import annotations

from collections.abc import Iterable


_IN_PROGRESS_TOOL_STATUSES = {"streaming", "validating", "processing", "working"}


def derive_run_status(*, current_status: str | None, tool_call_statuses: Iterable[str]) -> str | None:
    statuses = list(tool_call_statuses)

    if current_status == "paused":
        return "paused"
    if any(status == "pending" for status in statuses):
        return "waiting"
    if any(status in _IN_PROGRESS_TOOL_STATUSES for status in statuses):
        return "processing"
    if any(status == "rejected" for status in statuses):
        return "paused"
    if statuses:
        return "done"
    return current_status

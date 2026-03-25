from __future__ import annotations

RUN_RESUME_BLOCKED_STATUSES = {"running"}
RUN_PAUSABLE_STATUSES = {"running", "waiting", "processing"}
RUN_CANCELABLE_STATUSES = {"queued", "running", "waiting", "processing", "paused", "error"}
THREAD_DELETE_PRE_CLEANUP_STATUSES = {"running", "waiting", "processing", "paused", "error"}
RUN_EXECUTION_NOOP_STATUSES = {"canceled", "paused"}

__all__ = [
    "RUN_CANCELABLE_STATUSES",
    "RUN_EXECUTION_NOOP_STATUSES",
    "RUN_PAUSABLE_STATUSES",
    "RUN_RESUME_BLOCKED_STATUSES",
    "THREAD_DELETE_PRE_CLEANUP_STATUSES",
]

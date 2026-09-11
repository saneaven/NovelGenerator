from __future__ import annotations


def run_event_version(run) -> dict:
    """Version captured with the state, not at delayed SSE publication time."""
    updated_at = getattr(run, "updated_at", None)
    return {
        **({"run_seq": run.run_seq} if getattr(run, "run_seq", None) is not None else {}),
        **({"run_updated_at": updated_at.isoformat()} if updated_at is not None else {}),
    }

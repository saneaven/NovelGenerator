"""Admin memory diagnostics endpoints.

Gated at router-registration time by ``ADMIN_MEMORY_DIAGNOSTICS_ENABLED``.
When disabled, these endpoints are never mounted on the FastAPI app.
"""

from __future__ import annotations

import gc
import tracemalloc
from collections import Counter
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import require_admin
from ..models.db_models import User


router = APIRouter(prefix="/api/v1/admin/memory", tags=["admin", "admin-memory"])


class TopTypeEntry(BaseModel):
    type: str
    count: int


class TopAllocationEntry(BaseModel):
    location: str
    size_bytes: int
    count: int


class TracemallocState(BaseModel):
    enabled: bool
    traced_memory_current: int | None = None
    traced_memory_peak: int | None = None
    top_allocations: list[TopAllocationEntry] | None = None


class GcSnapshot(BaseModel):
    stats: list[dict[str, Any]]
    total_objects_gen2: int
    top_types_by_count: list[TopTypeEntry]


class MemorySummary(BaseModel):
    rss_bytes: int | None
    vms_bytes: int | None
    gc: GcSnapshot
    tracemalloc: TracemallocState


class TracemallocRequest(BaseModel):
    action: Literal["start", "stop", "reset"]


def _read_proc_self_status() -> dict[str, int]:
    """Parse /proc/self/status for VmRSS and VmSize. Returns bytes."""
    result: dict[str, int] = {}
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("VmRSS:") or line.startswith("VmSize:"):
                    parts = line.split()
                    # Format: "VmRSS:    12345 kB"
                    if len(parts) >= 2:
                        try:
                            kb = int(parts[1])
                            result[parts[0].rstrip(":")] = kb * 1024
                        except ValueError:
                            pass
    except OSError:
        pass
    return result


def _build_tracemalloc_state() -> TracemallocState:
    if not tracemalloc.is_tracing():
        return TracemallocState(enabled=False)

    current, peak = tracemalloc.get_traced_memory()
    snapshot = tracemalloc.take_snapshot()
    stats = snapshot.statistics("lineno")[:30]

    top_allocations = [
        TopAllocationEntry(
            location=str(stat.traceback),
            size_bytes=int(stat.size),
            count=int(stat.count),
        )
        for stat in stats
    ]

    return TracemallocState(
        enabled=True,
        traced_memory_current=int(current),
        traced_memory_peak=int(peak),
        top_allocations=top_allocations,
    )


@router.get("/summary", response_model=MemorySummary)
async def get_memory_summary(
    current_admin: User = Depends(require_admin),
) -> MemorySummary:
    proc = _read_proc_self_status()

    objs = gc.get_objects(generation=2)
    total_gen2 = len(objs)
    counter: Counter[str] = Counter(type(o).__name__ for o in objs)
    # Drop the list reference before the Counter is returned so the GC can
    # collect any transient references we just materialized.
    del objs
    top_types = [
        TopTypeEntry(type=name, count=count) for name, count in counter.most_common(50)
    ]

    return MemorySummary(
        rss_bytes=proc.get("VmRSS"),
        vms_bytes=proc.get("VmSize"),
        gc=GcSnapshot(
            stats=gc.get_stats(),
            total_objects_gen2=total_gen2,
            top_types_by_count=top_types,
        ),
        tracemalloc=_build_tracemalloc_state(),
    )


@router.post("/tracemalloc", response_model=TracemallocState)
async def control_tracemalloc(
    body: TracemallocRequest,
    current_admin: User = Depends(require_admin),
) -> TracemallocState:
    action = body.action
    if action == "start":
        if not tracemalloc.is_tracing():
            tracemalloc.start(25)
    elif action == "stop":
        if tracemalloc.is_tracing():
            tracemalloc.stop()
    elif action == "reset":
        if not tracemalloc.is_tracing():
            raise HTTPException(
                status_code=409,
                detail="tracemalloc is not running; start it before resetting.",
            )
        tracemalloc.clear_traces()
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    return _build_tracemalloc_state()

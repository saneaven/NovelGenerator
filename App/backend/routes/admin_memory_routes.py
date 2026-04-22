"""Admin memory diagnostics endpoints.

Gated at router-registration time by ``ADMIN_MEMORY_DIAGNOSTICS_ENABLED``.
When disabled, these endpoints are never mounted on the FastAPI app.
"""

from __future__ import annotations

import asyncio
import gc
import os
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
    count: list[int]
    threshold: list[int]
    total_objects_gen2: int
    top_types_by_count: list[TopTypeEntry]


class FdSnapshot(BaseModel):
    total: int | None = None
    sockets: int | None = None
    regular_files: int | None = None
    other: int | None = None


class AsyncioSnapshot(BaseModel):
    total: int | None = None
    done: int | None = None
    pending: int | None = None


class MemorySummary(BaseModel):
    rss_bytes: int | None
    vms_bytes: int | None
    process_status: dict[str, int | None]
    smaps_rollup: dict[str, int | None]
    fd: FdSnapshot
    asyncio: AsyncioSnapshot
    gc: GcSnapshot
    tracemalloc: TracemallocState


class TracemallocRequest(BaseModel):
    action: Literal["start", "stop", "reset"]


PROC_STATUS_FIELDS = (
    "VmRSS",
    "VmHWM",
    "VmSize",
    "VmData",
    "VmStk",
    "VmExe",
    "VmLib",
    "VmPTE",
    "RssAnon",
    "RssFile",
    "RssShmem",
    "Threads",
)
PROC_STATUS_BYTE_FIELDS = set(PROC_STATUS_FIELDS) - {"Threads"}
SMAPS_ROLLUP_FIELDS = (
    "Rss",
    "Pss",
    "Private_Clean",
    "Private_Dirty",
    "Shared_Clean",
    "Shared_Dirty",
    "Anonymous",
    "File",
    "Swap",
)


def _empty_metric_map(keys: tuple[str, ...]) -> dict[str, int | None]:
    return {key: None for key in keys}


def _read_proc_self_status() -> dict[str, int | None]:
    """Parse selected /proc/self/status fields. Memory values are bytes."""
    result = _empty_metric_map(PROC_STATUS_FIELDS)
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 2:
                    continue
                key = parts[0].rstrip(":")
                if key not in result:
                    continue
                try:
                    value = int(parts[1])
                except ValueError:
                    continue
                result[key] = value * 1024 if key in PROC_STATUS_BYTE_FIELDS else value
    except OSError:
        pass
    return result


def _read_smaps_rollup() -> dict[str, int | None]:
    """Parse selected /proc/self/smaps_rollup fields. Values are bytes."""
    result = _empty_metric_map(SMAPS_ROLLUP_FIELDS)
    try:
        with open("/proc/self/smaps_rollup", "r", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 2:
                    continue
                key = parts[0].rstrip(":")
                if key not in result:
                    continue
                try:
                    result[key] = int(parts[1]) * 1024
                except ValueError:
                    continue
    except OSError:
        pass
    return result


def _build_fd_snapshot() -> FdSnapshot:
    try:
        fd_names = os.listdir("/proc/self/fd")
    except OSError:
        return FdSnapshot()

    sockets = 0
    regular_files = 0
    other = 0
    for fd_name in fd_names:
        try:
            target = os.readlink(f"/proc/self/fd/{fd_name}")
        except OSError:
            other += 1
            continue

        if target.startswith("socket:"):
            sockets += 1
        elif target.startswith("/") and os.path.isfile(target):
            regular_files += 1
        else:
            other += 1

    return FdSnapshot(
        total=len(fd_names),
        sockets=sockets,
        regular_files=regular_files,
        other=other,
    )


def _build_asyncio_snapshot() -> AsyncioSnapshot:
    try:
        loop = asyncio.get_running_loop()
        tasks = list(asyncio.all_tasks(loop))
    except RuntimeError:
        return AsyncioSnapshot()

    done = sum(1 for task in tasks if task.done())
    pending = len(tasks) - done
    return AsyncioSnapshot(total=len(tasks), done=done, pending=pending)


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
    process_status = _read_proc_self_status()
    smaps_rollup = _read_smaps_rollup()

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
        rss_bytes=process_status.get("VmRSS"),
        vms_bytes=process_status.get("VmSize"),
        process_status=process_status,
        smaps_rollup=smaps_rollup,
        fd=_build_fd_snapshot(),
        asyncio=_build_asyncio_snapshot(),
        gc=GcSnapshot(
            stats=gc.get_stats(),
            count=list(gc.get_count()),
            threshold=list(gc.get_threshold()),
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

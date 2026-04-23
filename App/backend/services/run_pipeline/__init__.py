from __future__ import annotations

from ...database import SessionLocal
from ..runtime_event_dispatcher import runtime_event_dispatcher
from .service import RunPipeline

run_pipeline = RunPipeline(db_factory=SessionLocal, event_dispatcher=runtime_event_dispatcher)

__all__ = ["run_pipeline", "RunPipeline"]

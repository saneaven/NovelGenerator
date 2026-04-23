from __future__ import annotations

from ....models.db_models import RunModel, Thread
from .contracts import EmitFn


async def emit_stage(
    emit_fn: EmitFn | None,
    *,
    run: RunModel,
    thread: Thread,
    stage: str,
) -> None:
    if emit_fn is None:
        return

    await emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="run:stage",
        data={
            "run_id": str(run.id),
            "stage": stage,
        },
    )

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..models.db_models import Agent, Journey, NotificationModel, RunModel, RunToolCallModel, SubAgentDefinitionModel, Thread
from .notification_service import (
    build_agent_notification_snapshot,
    build_journey_notification_snapshot,
    build_sub_agent_notification_snapshot,
    upsert_notification_source,
)


@dataclass(frozen=True)
class ResolvedThreadParent:
    thread_type: str
    parent_id: str
    agent_id: str | None
    sub_agent_definition: SubAgentDefinitionModel | None
    journey: Journey | None
    journey_kind: str | None
    display_label: str | None
    project_id: str
    user_id: str


def resolve_parent(db: Session, thread: Thread) -> ResolvedThreadParent:
    if thread.thread_type == "journey":
        journey = db.query(Journey).filter(Journey.id == thread.parent_id).first()
        if journey is None:
            raise RuntimeError(f"Journey parent not found for thread {thread.id}")
        return ResolvedThreadParent(
            thread_type=thread.thread_type,
            parent_id=str(thread.parent_id),
            agent_id=None,
            sub_agent_definition=None,
            journey=journey,
            journey_kind=journey.kind,
            display_label=journey.display_label,
            project_id=str(thread.project_id),
            user_id=str(thread.user_id),
        )

    if thread.thread_type == "subAgent":
        sub_agent_definition = (
            db.query(SubAgentDefinitionModel)
            .filter(SubAgentDefinitionModel.id == thread.parent_id)
            .first()
        )
        return ResolvedThreadParent(
            thread_type=thread.thread_type,
            parent_id=str(thread.parent_id),
            agent_id=None,
            sub_agent_definition=sub_agent_definition,
            journey=None,
            journey_kind=None,
            display_label=None,
            project_id=str(thread.project_id),
            user_id=str(thread.user_id),
        )

    return ResolvedThreadParent(
        thread_type=thread.thread_type,
        parent_id=str(thread.parent_id),
        agent_id=str(thread.parent_id),
        sub_agent_definition=None,
        journey=None,
        journey_kind=None,
        display_label=None,
        project_id=str(thread.project_id),
        user_id=str(thread.user_id),
    )


def apply_parent_runtime_snapshot(
    db: Session,
    *,
    thread: Thread,
    run: RunModel,
    error: str | None,
) -> NotificationModel | None:
    parent = resolve_parent(db, thread)

    if parent.thread_type == "journey" and parent.journey is not None:
        journey = parent.journey
        journey.status = run.status
        journey.last_error = error if run.status == "error" else None

        row = upsert_notification_source(
            db,
            snapshot=build_journey_notification_snapshot(
                journey=journey,
                thread=thread,
                run=run,
                error=error,
            ),
        )
        db.flush()
        return row

    if parent.thread_type == "agent" and parent.agent_id is not None:
        agent = db.query(Agent).filter(Agent.id == parent.agent_id).first()
        if agent is None:
            return None

        row = upsert_notification_source(
            db,
            snapshot=build_agent_notification_snapshot(
                agent=agent,
                thread=thread,
                run=run,
                error=error,
            ),
        )
        db.flush()
        return row

    if parent.thread_type == "subAgent" and parent.sub_agent_definition is not None:
        # Find parent agent via the tool call that spawned this sub agent thread
        parent_tc = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.child_thread_id == thread.id)
            .first()
        )
        if parent_tc is None:
            return None

        parent_thread = db.query(Thread).filter(Thread.id == parent_tc.thread_id).first()
        if parent_thread is None or parent_thread.thread_type != "agent":
            return None

        parent_agent = db.query(Agent).filter(Agent.id == parent_thread.parent_id).first()
        if parent_agent is None:
            return None

        row = upsert_notification_source(
            db,
            snapshot=build_sub_agent_notification_snapshot(
                definition=parent.sub_agent_definition,
                parent_agent=parent_agent,
                parent_thread_id=str(parent_tc.thread_id),
                parent_message_id=str(parent_tc.assistant_message_id) if parent_tc.assistant_message_id else "",
                thread=thread,
                run=run,
                error=error,
            ),
        )
        db.flush()
        return row

    return None


def thread_runtime_fields(db: Session, thread: Thread) -> dict[str, Any]:
    parent = resolve_parent(db, thread)
    return {
        "parent_id": thread.parent_id,
        "journey_kind": parent.journey_kind,
        "display_label": parent.display_label,
    }

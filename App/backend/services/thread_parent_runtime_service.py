from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..models.db_models import Journey, NotificationModel, RunModel, SubAgentDefinitionModel, Thread
from .notification_service import (
    NotificationSourceSnapshot,
    default_journey_label,
    map_run_status_to_notification_status,
    message_from_notification_status,
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
    if parent.thread_type != "journey" or parent.journey is None:
        return None

    journey = parent.journey
    journey.status = run.status
    journey.last_error = error if run.status == "error" else None

    mapped_status = map_run_status_to_notification_status(run.status)
    row = upsert_notification_source(
        db,
        snapshot=NotificationSourceSnapshot(
            user_id=journey.user_id,
            project_id=journey.project_id,
            source_kind="journey",
            source_id=str(journey.id),
            status=mapped_status,
            label=str(journey.display_label or "").strip() or default_journey_label(journey.kind),
            message=message_from_notification_status(status=mapped_status, error=error),
            warning=error if mapped_status == "error" else None,
            progress=None,
            custom_slot={"type": "none"},
            target={
                "kind": "journey",
                "project_id": str(journey.project_id),
                "journey_id": str(journey.id),
            },
            meta={
                "journey_id": str(journey.id),
                "thread_id": str(thread.id),
                "run_id": str(run.id),
                "journey_kind": journey.kind,
                "project_id": str(journey.project_id),
            },
            important=mapped_status in {"pending", "error"},
        ),
    )
    db.flush()
    return row


def thread_runtime_fields(db: Session, thread: Thread) -> dict[str, Any]:
    parent = resolve_parent(db, thread)
    return {
        "parent_id": thread.parent_id,
        "journey_kind": parent.journey_kind,
        "display_label": parent.display_label,
    }

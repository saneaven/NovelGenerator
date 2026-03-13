from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.db_models import Journey, RunMessageModel, RunModel, RunToolCallModel, Thread
from ..services.chat_attachment_service import IncomingMessageAttachment
from ..services.notification_service import (
    ACTIVE_THREAD_DELETE_STATUSES,
    NotificationDeleteRow,
    default_journey_label,
    delete_notification_source,
    serialize_notification,
)
from ..services.run_pipeline.contracts import CreateContext
from ..services.runtime_event_dispatcher import RuntimeEventDispatcher
from ..services.settings_service import settings_service
from ..services.mcp import mcp_policy_service, mcp_resolver
from ..services.storage_usage_service import (
    StorageQuotaExceededError,
    apply_project_usage_deltas,
    build_run_delta,
    build_run_message_delta,
    snapshot_run_message_row,
    snapshot_run_row,
)
from ..services.thread_parent_runtime_service import apply_parent_runtime_snapshot


@dataclass(frozen=True)
class JourneyRuntimeRow:
    journey_id: UUID
    project_id: UUID
    thread_id: UUID
    latest_run_id: UUID | None
    latest_message_at: datetime | None
    kind: str
    display_label: str
    status: str
    last_error: str | None
    updated_at: datetime


class JourneyService:
    def __init__(self, *, db_factory, run_pipeline, event_dispatcher: RuntimeEventDispatcher) -> None:
        self._db_factory = db_factory
        self._run_pipeline = run_pipeline
        self._event_dispatcher = event_dispatcher

    def require_owned_journey(
        self,
        db: Session,
        *,
        journey_id: UUID,
        user_id: UUID,
        project_id: UUID | None = None,
    ) -> Journey:
        q = db.query(Journey).filter(Journey.id == journey_id, Journey.user_id == user_id)
        if project_id is not None:
            q = q.filter(Journey.project_id == project_id)
        row = q.first()
        if row is None:
            raise HTTPException(status_code=404, detail="Journey not found")
        return row

    def get_child_thread(self, db: Session, *, journey_id: UUID) -> Thread | None:
        return (
            db.query(Thread)
            .filter(Thread.thread_type == "journey", Thread.parent_id == journey_id)
            .first()
        )

    def list_project_journeys(
        self,
        db: Session,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> list[JourneyRuntimeRow]:
        journeys = (
            db.query(Journey)
            .filter(Journey.project_id == project_id, Journey.user_id == user_id)
            .order_by(Journey.updated_at.desc(), Journey.id.desc())
            .all()
        )
        if not journeys:
            return []

        journey_ids = [row.id for row in journeys]
        threads = (
            db.query(Thread)
            .filter(Thread.thread_type == "journey", Thread.parent_id.in_(journey_ids))
            .all()
        )
        thread_by_journey_id = {thread.parent_id: thread for thread in threads}
        thread_ids = [thread.id for thread in threads]

        latest_run_rows = (
            db.query(RunModel)
            .filter(RunModel.thread_id.in_(thread_ids))
            .order_by(RunModel.thread_id.asc(), RunModel.run_seq.desc(), RunModel.id.desc())
            .all()
            if thread_ids
            else []
        )
        latest_run_by_thread: dict[UUID, RunModel] = {}
        for row in latest_run_rows:
            latest_run_by_thread.setdefault(row.thread_id, row)

        latest_message_rows = (
            db.query(RunMessageModel.thread_id, func.max(RunMessageModel.created_at))
            .filter(RunMessageModel.thread_id.in_(thread_ids))
            .group_by(RunMessageModel.thread_id)
            .all()
            if thread_ids
            else []
        )
        latest_message_at_by_thread = {thread_id: created_at for thread_id, created_at in latest_message_rows}

        out: list[JourneyRuntimeRow] = []
        for journey in journeys:
            thread = thread_by_journey_id.get(journey.id)
            if thread is None:
                continue
            latest_run = latest_run_by_thread.get(thread.id)
            out.append(
                JourneyRuntimeRow(
                    journey_id=journey.id,
                    project_id=journey.project_id,
                    thread_id=thread.id,
                    latest_run_id=latest_run.id if latest_run is not None else None,
                    latest_message_at=latest_message_at_by_thread.get(thread.id),
                    kind=journey.kind,
                    display_label=journey.display_label,
                    status=journey.status,
                    last_error=journey.last_error,
                    updated_at=journey.updated_at,
                )
            )
        return out

    async def create_and_start_journey(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        kind: str,
        display_label: str | None,
        input_text: str,
        input_payload: dict[str, Any] | None,
        run_mode: str | None,
        surface: str | None,
        context_object_ids: list[UUID],
        journey_target_ids: list[UUID],
        language: str | None,
        attachments: list[IncomingMessageAttachment] | None = None,
        mcp_selections: list[Any] | None = None,
    ) -> tuple[Journey, Thread, RunModel]:
        normalized_input_payload = input_payload if isinstance(input_payload, dict) else {}
        text = str(input_text or "").strip()
        normalized_label = str(display_label or "").strip() or default_journey_label(kind)
        normalized_attachments = list(attachments or [])
        normalized_mcp_selections = list(mcp_selections or [])

        db = self._db_factory()
        try:
            settings = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
            resolved_language = language or settings.main_language
            preset_id = settings_service.get_active_preset_id(db, user_id)

            journey = Journey(
                project_id=project_id,
                user_id=user_id,
                kind=kind,
                display_label=normalized_label,
                status="running",
                last_error=None,
            )
            db.add(journey)
            db.flush()

            thread = Thread(
                project_id=project_id,
                user_id=user_id,
                thread_type="journey",
                parent_id=journey.id,
                status="running",
            )
            db.add(thread)
            db.flush()

            run = RunModel(
                thread_id=thread.id,
                user_id=user_id,
                project_id=project_id,
                status="running",
                run_seq=thread.next_run_seq,
                language=resolved_language,
                run_mode=run_mode,
                surface=surface,
                context_object_ids=[str(x) for x in context_object_ids],
                journey_target_ids=[str(x) for x in journey_target_ids],
                input_payload=normalized_input_payload,
                mcp_request_json={
                    "selections": [
                        item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                        for item in normalized_mcp_selections
                    ]
                },
            )
            db.add(run)
            db.flush()

            if normalized_mcp_selections:
                if preset_id is None:
                    raise RuntimeError("No active preset selected")
                mcp_ctx = mcp_policy_service.build_runtime_context(
                    db,
                    user_id=user_id,
                    preset_id=preset_id,
                    thread=thread,
                    run=run,
                    input_text=text,
                    input_payload=normalized_input_payload,
                )
                resolution = await mcp_resolver.resolve_selections(
                    ctx=mcp_ctx,
                    selections=normalized_mcp_selections,
                    project_id=project_id,
                )
                run.mcp_resolution_json = resolution.model_dump(mode="json")

            msg = RunMessageModel(
                thread_id=thread.id,
                run_id=run.id,
                seq=run.next_message_seq,
                seq_in_thread=thread.next_message_seq,
                role="user",
                data={
                    resolved_language: {
                        "contentParts": ([{"type": "content", "text": text}] if text else []),
                        "meta": {
                            "mcpSelections": (
                                run.mcp_resolution_json.get("audit", [])
                                if isinstance(run.mcp_resolution_json, dict)
                                else []
                            )
                        },
                    },
                },
            )
            db.add(msg)
            db.flush()

            run.next_message_seq += 1
            thread.next_message_seq += 1
            thread.next_run_seq += 1

            notification_row = apply_parent_runtime_snapshot(
                db,
                thread=thread,
                run=run,
                error=None,
            )

            apply_project_usage_deltas(
                db,
                user_id=user_id,
                project_id=project_id,
                deltas=[
                    build_run_delta(None, snapshot_run_row(run)),
                    build_run_message_delta(None, snapshot_run_message_row(msg)),
                ],
                enforce_quota=True,
            )
            db.commit()
            db.refresh(journey)
            db.refresh(thread)
            db.refresh(run)
            db.refresh(msg)
            if notification_row is not None:
                db.refresh(notification_row)
        except StorageQuotaExceededError:
            db.rollback()
            raise HTTPException(status_code=413, detail="Storage quota exceeded")
        finally:
            db.close()

        await self._event_dispatcher.emit_runtime_event(
            user_id=user_id,
            project_id=project_id,
            thread_id=thread.id,
            event_name="message:user",
            data={
                "run_id": str(run.id),
                "message_id": str(msg.id),
                "role": "user",
                "seq": int(msg.seq),
                "seq_in_thread": int(msg.seq_in_thread),
                "data": msg.data,
                "attachments": [],
            },
        )
        if notification_row is not None:
            await self._event_dispatcher.emit_project_event(
                user_id=user_id,
                project_id=project_id,
                event_name="notification:upsert",
                data=serialize_notification(notification_row),
            )
        await self._run_pipeline.spawn_execute_loop(
            run.id,
            create_ctx=CreateContext(
                input_text=text,
                input_payload=normalized_input_payload,
            ),
        )
        return journey, thread, run

    async def delete_journey(
        self,
        *,
        project_id: UUID,
        journey_id: UUID,
        user_id: UUID,
    ) -> tuple[str | None, list[str]]:
        db = self._db_factory()
        try:
            journey = self.require_owned_journey(
                db,
                journey_id=journey_id,
                user_id=user_id,
                project_id=project_id,
            )
            thread = self.get_child_thread(db, journey_id=journey.id)
            if thread is not None and thread.status in ACTIVE_THREAD_DELETE_STATUSES:
                db.close()
                await self._run_pipeline.cancel_run_for_delete(thread_id=thread.id, user_id=user_id)
                db = self._db_factory()
                journey = self.require_owned_journey(
                    db,
                    journey_id=journey_id,
                    user_id=user_id,
                    project_id=project_id,
                )
                thread = self.get_child_thread(db, journey_id=journey.id)

            deleted_notification = delete_notification_source(
                db,
                user_id=user_id,
                source_kind="journey",
                source_id=journey.id,
            )
            deleted_thread_ids: list[str] = []
            if thread is not None:
                deleted_thread_ids.append(str(thread.id))
                db.delete(thread)
            db.delete(journey)
            db.commit()
        finally:
            db.close()

        if deleted_notification is not None:
            await self._event_dispatcher.emit_user_event(
                user_id=user_id,
                event_name="notification:delete",
                data={"id": deleted_notification.id},
                project_id=project_id,
            )
        if deleted_thread_ids:
            await self._event_dispatcher.emit_project_event(
                user_id=user_id,
                project_id=project_id,
                event_name="thread:delete" if len(deleted_thread_ids) == 1 else "thread:bulk_delete",
                data={"id": deleted_thread_ids[0]} if len(deleted_thread_ids) == 1 else {"ids": deleted_thread_ids},
            )
        return deleted_notification.id if deleted_notification is not None else None, deleted_thread_ids

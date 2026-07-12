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
    NotificationDeleteRow,
    default_journey_label,
    delete_notification_source,
    serialize_notification,
)
from ..services.run_status_policy import THREAD_DELETE_PRE_CLEANUP_STATUSES
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

    def _list_owned_project_journey_rows(
        self,
        db: Session,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> list[Any]:
        return (
            db.query(
                Journey.id.label("journey_id"),
                Journey.project_id.label("project_id"),
                Journey.kind.label("kind"),
                Journey.display_label.label("display_label"),
                Journey.status.label("status"),
                Journey.last_error.label("last_error"),
                Journey.updated_at.label("updated_at"),
            )
            .filter(Journey.project_id == project_id, Journey.user_id == user_id)
            .order_by(Journey.updated_at.desc(), Journey.id.desc())
            .all()
        )

    def _load_child_thread_rows_by_journey_id(
        self,
        db: Session,
        *,
        journey_ids: list[UUID],
    ) -> dict[UUID, Any]:
        if not journey_ids:
            return {}
        rows = (
            db.query(
                Thread.id.label("thread_id"),
                Thread.parent_id.label("journey_id"),
            )
            .filter(Thread.thread_type == "journey", Thread.parent_id.in_(journey_ids))
            .all()
        )
        return {row.journey_id: row for row in rows}

    def _load_latest_run_ids_by_thread_id(
        self,
        db: Session,
        *,
        thread_ids: list[UUID],
    ) -> dict[UUID, UUID]:
        if not thread_ids:
            return {}

        ranked_runs = (
            db.query(
                RunModel.id.label("run_id"),
                RunModel.thread_id.label("thread_id"),
                func.row_number()
                .over(
                    partition_by=RunModel.thread_id,
                    order_by=(RunModel.run_seq.desc(), RunModel.id.desc()),
                )
                .label("run_rank"),
            )
            .filter(RunModel.thread_id.in_(thread_ids))
            .subquery()
        )
        rows = (
            db.query(ranked_runs.c.run_id, ranked_runs.c.thread_id)
            .filter(ranked_runs.c.run_rank == 1)
            .all()
        )
        return {row.thread_id: row.run_id for row in rows}

    def _load_latest_message_times_by_thread_id(
        self,
        db: Session,
        *,
        thread_ids: list[UUID],
    ) -> dict[UUID, datetime]:
        if not thread_ids:
            return {}
        rows = (
            db.query(
                RunMessageModel.thread_id.label("thread_id"),
                func.max(RunMessageModel.created_at).label("latest_message_at"),
            )
            .filter(RunMessageModel.thread_id.in_(thread_ids))
            .group_by(RunMessageModel.thread_id)
            .all()
        )
        return {row.thread_id: row.latest_message_at for row in rows}

    async def _emit_deleted_journey_events(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        deleted_notifications: list[NotificationDeleteRow],
        deleted_thread_ids: list[str],
    ) -> None:
        if len(deleted_notifications) == 1:
            await self._event_dispatcher.emit_user_event(
                user_id=user_id,
                event_name="notification:delete",
                data={"id": deleted_notifications[0].id},
                project_id=project_id,
            )
        elif deleted_notifications:
            await self._event_dispatcher.emit_user_event(
                user_id=user_id,
                event_name="notification:bulk_delete",
                data={"ids": [row.id for row in deleted_notifications]},
                project_id=project_id,
            )

        if len(deleted_thread_ids) == 1:
            await self._event_dispatcher.emit_project_event(
                user_id=user_id,
                project_id=project_id,
                event_name="thread:delete",
                data={"id": deleted_thread_ids[0]},
            )
        elif deleted_thread_ids:
            await self._event_dispatcher.emit_project_event(
                user_id=user_id,
                project_id=project_id,
                event_name="thread:bulk_delete",
                data={"ids": deleted_thread_ids},
            )

    def list_project_journeys(
        self,
        db: Session,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> list[JourneyRuntimeRow]:
        journeys = self._list_owned_project_journey_rows(
            db,
            project_id=project_id,
            user_id=user_id,
        )
        if not journeys:
            return []

        journey_ids = [row.journey_id for row in journeys]
        thread_by_journey_id = self._load_child_thread_rows_by_journey_id(
            db,
            journey_ids=journey_ids,
        )
        threads = list(thread_by_journey_id.values())
        thread_ids = [thread.thread_id for thread in threads]

        latest_run_id_by_thread = self._load_latest_run_ids_by_thread_id(
            db,
            thread_ids=thread_ids,
        )
        latest_message_at_by_thread = self._load_latest_message_times_by_thread_id(
            db,
            thread_ids=thread_ids,
        )

        out: list[JourneyRuntimeRow] = []
        for journey in journeys:
            thread = thread_by_journey_id.get(journey.journey_id)
            if thread is None:
                continue
            out.append(
                JourneyRuntimeRow(
                    journey_id=journey.journey_id,
                    project_id=journey.project_id,
                    thread_id=thread.thread_id,
                    latest_run_id=latest_run_id_by_thread.get(thread.thread_id),
                    latest_message_at=latest_message_at_by_thread.get(thread.thread_id),
                    kind=journey.kind,
                    display_label=journey.display_label,
                    status=journey.status,
                    last_error=journey.last_error,
                    updated_at=journey.updated_at,
                )
            )
        return out

    def get_owned_journey_runtime(
        self,
        db: Session,
        *,
        journey_id: UUID,
        user_id: UUID,
    ) -> JourneyRuntimeRow:
        journey = (
            db.query(
                Journey.id.label("journey_id"),
                Journey.project_id.label("project_id"),
                Journey.kind.label("kind"),
                Journey.display_label.label("display_label"),
                Journey.status.label("status"),
                Journey.last_error.label("last_error"),
                Journey.updated_at.label("updated_at"),
            )
            .filter(Journey.id == journey_id, Journey.user_id == user_id)
            .first()
        )
        if journey is None:
            raise HTTPException(status_code=404, detail="Journey not found")

        thread = (
            db.query(Thread.id.label("thread_id"))
            .filter(Thread.thread_type == "journey", Thread.parent_id == journey.journey_id)
            .first()
        )
        if thread is None:
            raise RuntimeError("Journey runtime row not found after ownership check")

        latest_run = (
            db.query(RunModel.id.label("run_id"))
            .filter(RunModel.thread_id == thread.thread_id)
            .order_by(RunModel.run_seq.desc(), RunModel.id.desc())
            .first()
        )
        latest_message_at = (
            db.query(func.max(RunMessageModel.created_at).label("latest_message_at"))
            .filter(RunMessageModel.thread_id == thread.thread_id)
            .scalar()
        )

        return JourneyRuntimeRow(
            journey_id=journey.journey_id,
            project_id=journey.project_id,
            thread_id=thread.thread_id,
            latest_run_id=latest_run.run_id if latest_run is not None else None,
            latest_message_at=latest_message_at,
            kind=journey.kind,
            display_label=journey.display_label,
            status=journey.status,
            last_error=journey.last_error,
            updated_at=journey.updated_at,
        )

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
            resolved_language = settings.main_language
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
        discovery_db = self._db_factory()
        try:
            journey = self.require_owned_journey(
                discovery_db,
                journey_id=journey_id,
                user_id=user_id,
                project_id=project_id,
            )
            thread = self.get_child_thread(discovery_db, journey_id=journey.id)
            active_thread_id = (
                thread.id
                if thread is not None and thread.status in THREAD_DELETE_PRE_CLEANUP_STATUSES
                else None
            )
        finally:
            discovery_db.close()

        if active_thread_id is not None:
            await self._run_pipeline.cancel_run_for_delete(thread_id=active_thread_id, user_id=user_id)

        db = self._db_factory()
        deleted_notification: NotificationDeleteRow | None = None
        deleted_thread_ids: list[str] = []
        try:
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
            if thread is not None:
                deleted_thread_ids.append(str(thread.id))
                db.query(Thread).filter(Thread.id == thread.id).delete(synchronize_session=False)
            db.query(Journey).filter(Journey.id == journey.id).delete(synchronize_session=False)
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        await self._emit_deleted_journey_events(
            user_id=user_id,
            project_id=project_id,
            deleted_notifications=[deleted_notification] if deleted_notification is not None else [],
            deleted_thread_ids=deleted_thread_ids,
        )
        return deleted_notification.id if deleted_notification is not None else None, deleted_thread_ids

    async def delete_all_project_journeys(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> int:
        # --- discovery phase: fetch only IDs to find active threads ---
        discovery_db = self._db_factory()
        try:
            journey_ids = [
                row[0] for row in
                discovery_db.query(Journey.id)
                .filter(Journey.project_id == project_id, Journey.user_id == user_id)
                .all()
            ]
            if not journey_ids:
                return 0
            active_thread_ids = [
                row[0] for row in
                discovery_db.query(Thread.id)
                .filter(
                    Thread.thread_type == "journey",
                    Thread.parent_id.in_(journey_ids),
                    Thread.status.in_(THREAD_DELETE_PRE_CLEANUP_STATUSES),
                )
                .all()
            ]
        finally:
            discovery_db.close()

        for thread_id in active_thread_ids:
            await self._run_pipeline.cancel_run_for_delete(thread_id=thread_id, user_id=user_id)

        # --- deletion phase: bulk SQL DELETE, let DB CASCADE handle children ---
        db = self._db_factory()
        deleted_notifications: list[NotificationDeleteRow] = []
        deleted_thread_ids: list[str] = []
        try:
            # Re-fetch IDs in the deletion session
            journey_ids = [
                row[0] for row in
                db.query(Journey.id)
                .filter(Journey.project_id == project_id, Journey.user_id == user_id)
                .all()
            ]
            if not journey_ids:
                return 0

            # Fetch thread IDs (lightweight, no child loading)
            thread_rows = (
                db.query(Thread.id)
                .filter(Thread.thread_type == "journey", Thread.parent_id.in_(journey_ids))
                .all()
            )
            deleted_thread_ids = [str(row[0]) for row in thread_rows]
            thread_ids = [row[0] for row in thread_rows]

            # Delete notifications per journey (lightweight)
            for jid in journey_ids:
                deleted_notification = delete_notification_source(
                    db,
                    user_id=user_id,
                    source_kind="journey",
                    source_id=jid,
                )
                if deleted_notification is not None:
                    deleted_notifications.append(deleted_notification)

            # Bulk delete threads — DB ON DELETE CASCADE handles runs, messages, etc.
            if thread_ids:
                db.query(Thread).filter(Thread.id.in_(thread_ids)).delete(synchronize_session=False)

            # Bulk delete journeys
            db.query(Journey).filter(Journey.id.in_(journey_ids)).delete(synchronize_session=False)

            deleted_count = len(journey_ids)
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        await self._emit_deleted_journey_events(
            user_id=user_id,
            project_id=project_id,
            deleted_notifications=deleted_notifications,
            deleted_thread_ids=deleted_thread_ids,
        )
        return deleted_count

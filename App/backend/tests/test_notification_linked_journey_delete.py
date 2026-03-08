from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from App.backend.models.db_models import (
    ImageRunModel,
    NotificationModel,
    RunMessageModel,
    RunModel,
    RunToolCallModel,
    Thread,
)
from App.backend.routes import notification_routes
from App.backend.services import notification_service as notification_service_service
from App.backend.services.notification_service import NotificationDeleteTarget
from App.backend.services.run_pipeline.service import RunPipeline


class FakeNotificationDb:
    def __init__(self) -> None:
        self.expired = False
        self.committed = False

    def expire_all(self) -> None:
        self.expired = True

    def commit(self) -> None:
        self.committed = True


class FakeCollectionQuery:
    def __init__(self, rows: list[object]) -> None:
        self._rows = list(rows)

    def filter(self, *_args, **_kwargs) -> "FakeCollectionQuery":
        return self

    def all(self) -> list[object]:
        return list(self._rows)


class FakeCollectionDb:
    def __init__(self, rows_by_model: dict[object, list[object]]) -> None:
        self._rows_by_model = rows_by_model

    def query(self, model: object) -> FakeCollectionQuery:
        return FakeCollectionQuery(self._rows_by_model.get(model, []))


def _make_notification_row(
    *,
    notification_id: object,
    project_id: object,
    is_read: bool,
) -> SimpleNamespace:
    now = datetime(2026, 3, 8, 12, 0, 0)
    return SimpleNamespace(
        id=notification_id,
        project_id=project_id,
        source="journey",
        source_ref_id="source-ref",
        thread_id=None,
        status="success",
        label="Journey",
        message="Completed",
        warning=None,
        progress_json={"current": 1, "total": 1},
        custom_slot_json={"type": "none"},
        meta_json={"kind": "journey"},
        is_read=is_read,
        created_at=now,
        updated_at=now,
    )


def test_collect_notification_delete_deltas_includes_linked_journey_graph() -> None:
    user_id = uuid4()
    project_id = uuid4()
    notification_id = uuid4()
    thread_id = uuid4()

    db = FakeCollectionDb(
        {
            NotificationModel: [
                _make_notification_row(
                    notification_id=notification_id,
                    project_id=project_id,
                    is_read=False,
                )
            ],
            Thread: [
                SimpleNamespace(
                    id=thread_id,
                    user_id=user_id,
                    project_id=project_id,
                    thread_type="journey",
                    captured_history_system_prompt="system prompt",
                    captured_history_conversation_json=[{"role": "assistant", "content": "done"}],
                )
            ],
            RunModel: [
                SimpleNamespace(
                    thread_id=thread_id,
                    error="boom",
                    context_object_ids=["obj-1"],
                    journey_target_ids=["target-1"],
                    input_payload={"prompt": "go"},
                )
            ],
            RunMessageModel: [
                SimpleNamespace(
                    thread_id=thread_id,
                    data={"parts": ["message"]},
                )
            ],
            RunToolCallModel: [
                SimpleNamespace(
                    thread_id=thread_id,
                    arguments={"kind": "delete"},
                    extra_content={"preview": True},
                    reason="cleanup",
                    result={"ok": True},
                )
            ],
            ImageRunModel: [
                SimpleNamespace(
                    thread_id=thread_id,
                    request_snapshot={"prompt": "scene"},
                    revised_prompt="scene revised",
                    before_excerpt="before",
                    after_excerpt="after",
                    failure_code=None,
                    error_message=None,
                )
            ],
        }
    )

    deltas = notification_service_service.collect_notification_delete_deltas(
        db,
        user_id=user_id,
        project_id=project_id,
        targets=[
            NotificationDeleteTarget(
                notification_id=notification_id,
                source="journey",
                source_ref_id=str(thread_id),
                linked_thread_id=thread_id,
                linked_thread_status="done",
            )
        ],
    )

    assert len(deltas) == 6
    assert sum(1 for delta in deltas if delta.notification_bytes < 0) == 1
    assert sum(1 for delta in deltas if delta.image_run_bytes < 0) == 1
    assert sum(1 for delta in deltas if delta.chat_bytes < 0) == 4


def test_mark_project_notifications_read_emits_upsert_payloads(monkeypatch) -> None:
    project_id = uuid4()
    user_id = uuid4()
    notification_id = uuid4()
    db = FakeNotificationDb()
    emitted: list[tuple[str, dict[str, object]]] = []
    reloaded_rows = [
        _make_notification_row(
            notification_id=notification_id,
            project_id=project_id,
            is_read=True,
        )
    ]

    monkeypatch.setattr(notification_routes, "require_owned_project", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(
        notification_routes,
        "mark_notifications_read",
        lambda *_args, **_kwargs: [str(notification_id)],
    )
    monkeypatch.setattr(
        notification_routes,
        "get_notifications_by_ids",
        lambda *_args, **_kwargs: reloaded_rows,
    )

    async def _fake_emit_project_event(*, project_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted.append((event_name, data))

    monkeypatch.setattr(notification_routes.runtime_event_dispatcher, "emit_project_event", _fake_emit_project_event)

    response = asyncio.run(
        notification_routes.mark_project_notifications_read(
            project_id=project_id,
            payload=SimpleNamespace(notification_ids=[str(notification_id)], mark_all=False),
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert response.updated == 1
    assert response.ids == [str(notification_id)]
    assert db.committed is True
    assert emitted == [
        (
            "notification:upsert",
            {
                "id": str(notification_id),
                "project_id": str(project_id),
                "source": "journey",
                "source_ref_id": "source-ref",
                "thread_id": None,
                "status": "success",
                "label": "Journey",
                "message": "Completed",
                "warning": None,
                "progress": {"current": 1, "total": 1},
                "custom_slot": {"type": "none"},
                "meta": {"kind": "journey"},
                "is_read": True,
                "created_at": "2026-03-08T12:00:00Z",
                "updated_at": "2026-03-08T12:00:00Z",
            },
        )
    ]


def test_delete_project_notification_cancels_and_emits_thread_delete(monkeypatch) -> None:
    project_id = uuid4()
    user_id = uuid4()
    notification_id = uuid4()
    thread_id = uuid4()
    db = FakeNotificationDb()
    emitted: list[tuple[str, dict[str, object]]] = []
    canceled: list[tuple[object, object]] = []

    monkeypatch.setattr(notification_routes, "require_owned_project", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(
        notification_routes,
        "list_notification_delete_targets",
        lambda *_args, **_kwargs: [
            NotificationDeleteTarget(
                notification_id=notification_id,
                source="journey",
                source_ref_id=str(thread_id),
                linked_thread_id=thread_id,
                linked_thread_status="running",
            )
        ],
    )
    monkeypatch.setattr(
        notification_routes,
        "delete_notification_targets",
        lambda *_args, **_kwargs: ([str(notification_id)], [str(thread_id)]),
    )
    helper_deltas = [object()]
    applied_deltas: list[list[object]] = []
    monkeypatch.setattr(
        notification_routes,
        "collect_notification_delete_deltas",
        lambda *_args, **_kwargs: helper_deltas,
    )
    monkeypatch.setattr(
        notification_routes,
        "apply_project_usage_deltas",
        lambda *_args, **_kwargs: applied_deltas.append(list(_kwargs["deltas"])),
    )

    async def _fake_cancel_run_for_delete(*, thread_id: object, user_id: object) -> None:
        canceled.append((thread_id, user_id))

    async def _fake_emit_project_event(*, project_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted.append((event_name, data))

    monkeypatch.setattr(notification_routes.run_pipeline, "cancel_run_for_delete", _fake_cancel_run_for_delete)
    monkeypatch.setattr(notification_routes.runtime_event_dispatcher, "emit_project_event", _fake_emit_project_event)

    response = asyncio.run(
        notification_routes.delete_project_notification(
            project_id=project_id,
            notification_id=notification_id,
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert response.status_code == 204
    assert db.expired is True
    assert db.committed is True
    assert applied_deltas == [helper_deltas]
    assert canceled == [(thread_id, user_id)]
    assert emitted == [
        (
            "notification:delete",
            {
                "id": str(notification_id),
                "source": "journey",
                "source_ref_id": str(thread_id),
            },
        ),
        (
            "thread:delete",
            {
                "id": str(thread_id),
            },
        ),
    ]


def test_delete_all_project_notifications_emits_bulk_thread_delete(monkeypatch) -> None:
    project_id = uuid4()
    user_id = uuid4()
    notif_a = uuid4()
    notif_b = uuid4()
    thread_a = uuid4()
    thread_b = uuid4()
    db = FakeNotificationDb()
    emitted: list[tuple[str, dict[str, object]]] = []
    canceled: list[tuple[object, object]] = []

    monkeypatch.setattr(notification_routes, "require_owned_project", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(
        notification_routes,
        "list_notification_delete_targets",
        lambda *_args, **_kwargs: [
            NotificationDeleteTarget(
                notification_id=notif_a,
                source="journey",
                source_ref_id=str(thread_a),
                linked_thread_id=thread_a,
                linked_thread_status="processing",
            ),
            NotificationDeleteTarget(
                notification_id=notif_b,
                source="imageRun",
                source_ref_id="image-run-1",
                linked_thread_id=None,
                linked_thread_status=None,
            ),
            NotificationDeleteTarget(
                notification_id=uuid4(),
                source="journey",
                source_ref_id=str(thread_b),
                linked_thread_id=thread_b,
                linked_thread_status="done",
            ),
        ],
    )
    monkeypatch.setattr(
        notification_routes,
        "delete_notification_targets",
        lambda *_args, **_kwargs: ([str(notif_a), str(notif_b)], [str(thread_a), str(thread_b)]),
    )
    helper_deltas = [object(), object()]
    applied_deltas: list[list[object]] = []
    monkeypatch.setattr(
        notification_routes,
        "collect_notification_delete_deltas",
        lambda *_args, **_kwargs: helper_deltas,
    )
    monkeypatch.setattr(
        notification_routes,
        "apply_project_usage_deltas",
        lambda *_args, **_kwargs: applied_deltas.append(list(_kwargs["deltas"])),
    )

    async def _fake_cancel_run_for_delete(*, thread_id: object, user_id: object) -> None:
        canceled.append((thread_id, user_id))

    async def _fake_emit_project_event(*, project_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted.append((event_name, data))

    monkeypatch.setattr(notification_routes.run_pipeline, "cancel_run_for_delete", _fake_cancel_run_for_delete)
    monkeypatch.setattr(notification_routes.runtime_event_dispatcher, "emit_project_event", _fake_emit_project_event)

    response = asyncio.run(
        notification_routes.delete_all_project_notifications(
            project_id=project_id,
            payload=SimpleNamespace(only_read=False),
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert response.deleted == 2
    assert response.ids == [str(notif_a), str(notif_b)]
    assert applied_deltas == [helper_deltas]
    assert canceled == [(thread_a, user_id)]
    assert emitted == [
        (
            "notification:bulk_delete",
            {
                "ids": [str(notif_a), str(notif_b)],
            },
        ),
        (
            "thread:bulk_delete",
            {
                "ids": [str(thread_a), str(thread_b)],
            },
        ),
    ]


def test_delete_project_notification_raises_404_when_target_missing(monkeypatch) -> None:
    project_id = uuid4()
    user_id = uuid4()
    notification_id = uuid4()

    monkeypatch.setattr(notification_routes, "require_owned_project", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(
        notification_routes,
        "list_notification_delete_targets",
        lambda *_args, **_kwargs: [],
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            notification_routes.delete_project_notification(
                project_id=project_id,
                notification_id=notification_id,
                current_user=SimpleNamespace(id=user_id),
                db=FakeNotificationDb(),
            )
        )

    assert exc.value.status_code == 404


class FakeQuery:
    def __init__(self, run: object) -> None:
        self._run = run

    def join(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def filter(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def order_by(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def first(self) -> object:
        return self._run


class FakeRunDb:
    def __init__(self, run: object) -> None:
        self._run = run
        self.committed = False
        self.closed = False

    def query(self, _model: object) -> FakeQuery:
        return FakeQuery(self._run)

    def commit(self) -> None:
        self.committed = True

    def close(self) -> None:
        self.closed = True


def test_cancel_run_for_delete_raises_on_timeout() -> None:
    thread_id = uuid4()
    run_id = uuid4()
    project_id = uuid4()
    thread = SimpleNamespace(status="running")
    run = SimpleNamespace(id=run_id, project_id=project_id, status="running", thread=thread)
    fake_db = FakeRunDb(run)
    pipeline = RunPipeline(db_factory=lambda: fake_db, event_dispatcher=SimpleNamespace())

    async def _fake_cancel_task_and_wait(_run_id: object, *, timeout_s: float = 5.0) -> bool:
        return False

    emitted: list[tuple[str, dict[str, object]]] = []

    async def _fake_emit(*, project_id: object, thread_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted.append((event_name, data))

    pipeline._cancel_task_and_wait = _fake_cancel_task_and_wait  # type: ignore[method-assign]
    pipeline._emit = _fake_emit  # type: ignore[method-assign]

    with pytest.raises(HTTPException) as exc:
        asyncio.run(pipeline.cancel_run_for_delete(thread_id=thread_id, user_id=uuid4(), timeout_s=0.1))

    assert exc.value.status_code == 409
    assert fake_db.committed is True
    assert run.status == "canceled"
    assert thread.status == "canceled"
    assert emitted == []


def test_cancel_run_for_delete_emits_canceled_events() -> None:
    thread_id = uuid4()
    run_id = uuid4()
    project_id = uuid4()
    thread = SimpleNamespace(status="processing")
    run = SimpleNamespace(id=run_id, project_id=project_id, status="processing", thread=thread)
    fake_db = FakeRunDb(run)
    pipeline = RunPipeline(db_factory=lambda: fake_db, event_dispatcher=SimpleNamespace())

    async def _fake_cancel_task_and_wait(_run_id: object, *, timeout_s: float = 5.0) -> bool:
        return True

    emitted: list[tuple[str, dict[str, object]]] = []

    async def _fake_emit(*, project_id: object, thread_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted.append((event_name, data))

    pipeline._cancel_task_and_wait = _fake_cancel_task_and_wait  # type: ignore[method-assign]
    pipeline._emit = _fake_emit  # type: ignore[method-assign]

    asyncio.run(pipeline.cancel_run_for_delete(thread_id=thread_id, user_id=uuid4(), timeout_s=0.1))

    assert emitted == [
        ("run:canceled", {"run_id": str(run_id)}),
        ("run:status", {"run_id": str(run_id), "status": "canceled"}),
    ]

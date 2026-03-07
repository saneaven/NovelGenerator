from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from App.backend.routes import notification_routes
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

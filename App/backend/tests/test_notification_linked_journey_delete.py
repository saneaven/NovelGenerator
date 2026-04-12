from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime
from types import ModuleType
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base

os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", str(1024 * 1024 * 1024))

if "jose" not in sys.modules:
    jose_module = ModuleType("jose")

    class _FakeJWTError(Exception):
        pass

    class _FakeJWT:
        @staticmethod
        def encode(*_args, **_kwargs) -> str:
            return "token"

        @staticmethod
        def decode(*_args, **_kwargs) -> dict[str, object]:
            return {}

    jose_module.JWTError = _FakeJWTError
    jose_module.jwt = _FakeJWT()
    sys.modules["jose"] = jose_module

if "App.backend.database" not in sys.modules:
    database_module = ModuleType("App.backend.database")
    base = declarative_base()

    def _fake_get_db():
        return None

    database_module.Base = base
    database_module.SessionLocal = lambda: None
    database_module.get_db = _fake_get_db
    sys.modules["App.backend.database"] = database_module

if "database" not in sys.modules:
    root_database_module = ModuleType("database")
    root_database_module.Base = declarative_base()
    root_database_module.SessionLocal = lambda: None
    sys.modules["database"] = root_database_module

from App.backend.routes import notification_routes
from App.backend.services import notification_service


class FakeNotificationDb:
    def __init__(self) -> None:
        self.committed = False
        self.deleted: list[object] = []

    def commit(self) -> None:
        self.committed = True

    def delete(self, row: object) -> None:
        self.deleted.append(row)

    def flush(self) -> None:
        return None


class FakeCollectionQuery:
    def __init__(self, rows: list[object]) -> None:
        self._rows = list(rows)

    def filter(self, *_args, **_kwargs) -> "FakeCollectionQuery":
        return self

    def all(self) -> list[object]:
        return list(self._rows)


class FakeCollectionDb(FakeNotificationDb):
    def __init__(self, rows: list[object]) -> None:
        super().__init__()
        self._rows = rows

    def query(self, _model: object) -> FakeCollectionQuery:
        return FakeCollectionQuery(self._rows)


def _notification_row(
    *,
    notification_id: object,
    user_id: object,
    project_id: object | None,
    source_kind: str = "journey",
    source_id: object | None = None,
    target_json: dict[str, object] | None = None,
    important: bool = False,
    is_read: bool = False,
) -> SimpleNamespace:
    now = datetime(2026, 3, 8, 12, 0, 0)
    return SimpleNamespace(
        id=notification_id,
        user_id=user_id,
        project_id=project_id,
        source_kind=source_kind,
        source_id=source_id or notification_id,
        target_json=target_json,
        status="done",
        label="Journey",
        message="Completed",
        warning=None,
        progress_json={"current": 1, "total": 1},
        custom_slot_json={"type": "none"},
        meta_json={"kind": source_kind},
        important=important,
        is_read=is_read,
        created_at=now,
        updated_at=now,
    )


def test_serialize_notification_includes_target_and_important() -> None:
    notification_id = uuid4()
    project_id = uuid4()
    thread_id = uuid4()

    payload = notification_service.serialize_notification(
        _notification_row(
            notification_id=notification_id,
            user_id=uuid4(),
            project_id=project_id,
            source_kind="journey",
            source_id=thread_id,
            target_json={
                "kind": "thread",
                "project_id": str(project_id),
                "thread_id": str(thread_id),
            },
            important=True,
        )
    )

    assert payload == {
        "id": str(notification_id),
        "project_id": str(project_id),
        "source": {
            "kind": "journey",
            "id": str(thread_id),
        },
        "status": "done",
        "label": "Journey",
        "message": "Completed",
        "warning": None,
        "progress": {"current": 1, "total": 1},
        "custom_slot": {"type": "none"},
        "target": {
            "kind": "thread",
            "project_id": str(project_id),
            "thread_id": str(thread_id),
        },
        "meta": {"kind": "journey"},
        "important": True,
        "is_read": False,
        "created_at": "2026-03-08T12:00:00Z",
        "updated_at": "2026-03-08T12:00:00Z",
    }


def test_build_journey_notification_snapshot_allows_ready_status() -> None:
    journey_id = uuid4()
    thread_id = uuid4()
    run_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()

    snapshot = notification_service.build_journey_notification_snapshot(
        journey=SimpleNamespace(
            id=journey_id,
            user_id=user_id,
            project_id=project_id,
            kind="imagePrompt",
            display_label="Prompt work",
        ),
        thread=SimpleNamespace(id=thread_id),
        run=SimpleNamespace(id=run_id, status="ready"),
        error=None,
    )

    assert snapshot.status == "ready"
    assert snapshot.message == "Ready to continue"
    assert snapshot.important is True


def test_delete_notifications_for_thread_ids_matches_target_only() -> None:
    user_id = uuid4()
    project_id = uuid4()
    thread_id = uuid4()
    other_thread_id = uuid4()

    matched_target = _notification_row(
        notification_id=uuid4(),
        user_id=user_id,
        project_id=project_id,
        target_json={
            "kind": "thread",
            "project_id": str(project_id),
            "thread_id": str(thread_id),
        },
    )
    unmatched_source = _notification_row(
        notification_id=uuid4(),
        user_id=user_id,
        project_id=project_id,
        source_kind="journey",
        source_id=thread_id,
        target_json={"kind": "none"},
    )
    untouched = _notification_row(
        notification_id=uuid4(),
        user_id=user_id,
        project_id=project_id,
        source_kind="journey",
        source_id=other_thread_id,
        target_json={
            "kind": "thread",
            "project_id": str(project_id),
            "thread_id": str(other_thread_id),
        },
    )

    db = FakeCollectionDb([matched_target, unmatched_source, untouched])

    deleted_rows = notification_service.delete_notifications_for_thread_ids(
        db,
        user_id=user_id,
        thread_ids=[thread_id],
        project_id=project_id,
    )

    assert {row.id for row in deleted_rows} == {str(matched_target.id)}
    assert db.deleted == [matched_target]


def test_mark_user_notifications_read_emits_user_upsert_payloads(monkeypatch) -> None:
    user_id = uuid4()
    notification_id = uuid4()
    project_id = uuid4()
    db = FakeNotificationDb()
    emitted: list[tuple[str, dict[str, object], object | None]] = []
    reloaded_rows = [
        _notification_row(
            notification_id=notification_id,
            user_id=user_id,
            project_id=project_id,
            is_read=True,
        )
    ]

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

    async def _fake_emit_user_event(*, user_id: object, event_name: str, data: dict[str, object], project_id: object | None = None) -> None:
        emitted.append((event_name, data, project_id))

    monkeypatch.setattr(notification_routes.runtime_event_dispatcher, "emit_user_event", _fake_emit_user_event)

    response = asyncio.run(
        notification_routes.mark_user_notifications_read(
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
            notification_service.serialize_notification(reloaded_rows[0]),
            project_id,
        )
    ]


def test_delete_notification_only_emits_notification_delete(monkeypatch) -> None:
    user_id = uuid4()
    notification_id = uuid4()
    project_id = uuid4()
    db = FakeNotificationDb()
    emitted: list[tuple[str, dict[str, object], object | None]] = []
    applied_deltas: list[tuple[object, list[object]]] = []

    existing_row = _notification_row(
        notification_id=notification_id,
        user_id=user_id,
        project_id=project_id,
    )

    monkeypatch.setattr(
        notification_routes,
        "get_notifications_by_ids",
        lambda *_args, **_kwargs: [existing_row],
    )
    monkeypatch.setattr(
        notification_routes,
        "collect_notification_delete_deltas",
        lambda *_args, **_kwargs: {project_id: [object()]},
    )
    monkeypatch.setattr(
        notification_routes,
        "delete_notifications",
        lambda *_args, **_kwargs: [notification_service.NotificationDeleteRow(id=str(notification_id), project_id=str(project_id))],
    )
    monkeypatch.setattr(
        notification_routes,
        "apply_project_usage_deltas",
        lambda *_args, **_kwargs: applied_deltas.append((_kwargs["project_id"], list(_kwargs["deltas"]))),
    )

    async def _fake_emit_user_event(*, user_id: object, event_name: str, data: dict[str, object], project_id: object | None = None) -> None:
        emitted.append((event_name, data, project_id))

    monkeypatch.setattr(notification_routes.runtime_event_dispatcher, "emit_user_event", _fake_emit_user_event)

    response = asyncio.run(
        notification_routes.delete_notification(
            notification_id=notification_id,
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert response.status_code == 204
    assert db.committed is True
    assert len(applied_deltas) == 1
    assert applied_deltas[0][0] == project_id
    assert emitted == [
        (
            "notification:delete",
            {"id": str(notification_id)},
            str(project_id),
        )
    ]


def test_delete_all_notifications_emits_bulk_delete(monkeypatch) -> None:
    user_id = uuid4()
    project_id = uuid4()
    notif_a = uuid4()
    notif_b = uuid4()
    db = FakeCollectionDb(
        [
            _notification_row(notification_id=notif_a, user_id=user_id, project_id=project_id),
            _notification_row(notification_id=notif_b, user_id=user_id, project_id=None, source_kind="system"),
        ]
    )
    emitted: list[tuple[str, dict[str, object], object | None]] = []

    monkeypatch.setattr(
        notification_routes,
        "collect_notification_delete_deltas",
        lambda *_args, **_kwargs: {project_id: [object()]},
    )
    monkeypatch.setattr(
        notification_routes,
        "delete_notifications",
        lambda *_args, **_kwargs: [
            notification_service.NotificationDeleteRow(id=str(notif_a), project_id=str(project_id)),
            notification_service.NotificationDeleteRow(id=str(notif_b), project_id=None),
        ],
    )
    monkeypatch.setattr(notification_routes, "apply_project_usage_deltas", lambda *_args, **_kwargs: None)

    async def _fake_emit_user_event(*, user_id: object, event_name: str, data: dict[str, object], project_id: object | None = None) -> None:
        emitted.append((event_name, data, project_id))

    monkeypatch.setattr(notification_routes.runtime_event_dispatcher, "emit_user_event", _fake_emit_user_event)

    response = asyncio.run(
        notification_routes.delete_all_notifications(
            payload=SimpleNamespace(only_read=False),
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert response.deleted == 2
    assert response.ids == [str(notif_a), str(notif_b)]
    assert db.committed is True
    assert emitted == [
        (
            "notification:bulk_delete",
            {"ids": [str(notif_a), str(notif_b)]},
            None,
        )
    ]

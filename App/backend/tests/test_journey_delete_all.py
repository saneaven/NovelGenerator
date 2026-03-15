from __future__ import annotations

import asyncio
import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")


def _install_import_stubs() -> None:
    if "App.backend.database" not in sys.modules:
        fake_database = types.ModuleType("App.backend.database")
        fake_database.Base = declarative_base()
        fake_database.SessionLocal = lambda: None
        fake_database.get_db = lambda: None
        sys.modules["App.backend.database"] = fake_database
    if "database" not in sys.modules:
        sys.modules["database"] = sys.modules["App.backend.database"]

    if "App.backend.auth" not in sys.modules:
        fake_auth = types.ModuleType("App.backend.auth")
        fake_auth.get_current_user = lambda: None
        sys.modules["App.backend.auth"] = fake_auth

    if "App.backend.services.ownership" not in sys.modules:
        fake_ownership = types.ModuleType("App.backend.services.ownership")
        fake_ownership.require_owned_project = lambda *_args, **_kwargs: None
        sys.modules["App.backend.services.ownership"] = fake_ownership

    if "App.backend.services.run_pipeline" not in sys.modules:
        fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
        fake_run_pipeline.run_pipeline = SimpleNamespace(
            cancel_run_for_delete=lambda *_args, **_kwargs: None,
            cancel_run=lambda *_args, **_kwargs: None,
            resume_run=lambda *_args, **_kwargs: None,
            spawn_execute_loop=lambda *_args, **_kwargs: None,
        )
        sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

    if "App.backend.services.run_pipeline.contracts" not in sys.modules:
        fake_run_pipeline_contracts = types.ModuleType("App.backend.services.run_pipeline.contracts")

        class CreateContext:
            def __init__(self, **_kwargs) -> None:
                pass

        fake_run_pipeline_contracts.CreateContext = CreateContext
        sys.modules["App.backend.services.run_pipeline.contracts"] = fake_run_pipeline_contracts

    if "App.backend.services.runtime_event_dispatcher" not in sys.modules:
        fake_runtime_event_dispatcher = types.ModuleType("App.backend.services.runtime_event_dispatcher")
        fake_runtime_event_dispatcher.RuntimeEventDispatcher = object
        fake_runtime_event_dispatcher.runtime_event_dispatcher = SimpleNamespace(
            emit_user_event=lambda *_args, **_kwargs: None,
            emit_project_event=lambda *_args, **_kwargs: None,
        )
        sys.modules["App.backend.services.runtime_event_dispatcher"] = fake_runtime_event_dispatcher

    if "App.backend.services.settings_service" not in sys.modules:
        fake_settings_service = types.ModuleType("App.backend.services.settings_service")
        fake_settings_service.settings_service = SimpleNamespace(
            _get_settings=lambda *_args, **_kwargs: SimpleNamespace(main_language="English"),
            get_active_preset_id=lambda *_args, **_kwargs: None,
        )
        sys.modules["App.backend.services.settings_service"] = fake_settings_service

    if "App.backend.services.mcp" not in sys.modules:
        fake_mcp = types.ModuleType("App.backend.services.mcp")
        fake_mcp.mcp_policy_service = SimpleNamespace(build_runtime_context=lambda *_args, **_kwargs: None)
        fake_mcp.mcp_resolver = SimpleNamespace(resolve_selections=lambda *_args, **_kwargs: None)
        sys.modules["App.backend.services.mcp"] = fake_mcp

    if "App.backend.services.storage_usage_service" not in sys.modules:
        fake_storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")

        class StorageUsageDelta:
            def __init__(self, **_kwargs) -> None:
                pass

        class StorageQuotaExceededError(Exception):
            pass

        fake_storage_usage_service.StorageUsageDelta = StorageUsageDelta
        fake_storage_usage_service.StorageQuotaExceededError = StorageQuotaExceededError
        fake_storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
        fake_storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
        fake_storage_usage_service.build_image_run_delta = lambda *_args, **_kwargs: object()
        fake_storage_usage_service.build_notification_delta = lambda *_args, **_kwargs: object()
        fake_storage_usage_service.build_run_delta = lambda *_args, **_kwargs: object()
        fake_storage_usage_service.build_run_message_delta = lambda *_args, **_kwargs: object()
        fake_storage_usage_service.build_thread_delta = lambda *_args, **_kwargs: object()
        fake_storage_usage_service.build_tool_call_delta = lambda *_args, **_kwargs: object()
        fake_storage_usage_service.snapshot_image_run_row = lambda row: row
        fake_storage_usage_service.snapshot_notification_row = lambda row: row
        fake_storage_usage_service.snapshot_run_message_row = lambda row: row
        fake_storage_usage_service.snapshot_run_row = lambda row: row
        fake_storage_usage_service.snapshot_thread_row = lambda row: row
        fake_storage_usage_service.snapshot_tool_call_row = lambda row: row
        sys.modules["App.backend.services.storage_usage_service"] = fake_storage_usage_service

    if "App.backend.services.chat_attachment_service" not in sys.modules:
        fake_chat_attachment_service = types.ModuleType("App.backend.services.chat_attachment_service")

        class IncomingMessageAttachment:
            pass

        fake_chat_attachment_service.IncomingMessageAttachment = IncomingMessageAttachment
        sys.modules["App.backend.services.chat_attachment_service"] = fake_chat_attachment_service

    if "App.backend.services.thread_parent_runtime_service" not in sys.modules:
        fake_thread_parent_runtime_service = types.ModuleType("App.backend.services.thread_parent_runtime_service")
        fake_thread_parent_runtime_service.apply_parent_runtime_snapshot = lambda *_args, **_kwargs: None
        sys.modules["App.backend.services.thread_parent_runtime_service"] = fake_thread_parent_runtime_service


_install_import_stubs()

from App.backend.models.db_models import Journey, Thread
from App.backend.routes import journey_routes
from App.backend.services import journey_service as journey_service_module


class FakeQuery:
    def __init__(self, rows: list[object]) -> None:
        self._rows = list(rows)

    def filter(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def order_by(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def all(self) -> list[object]:
        return list(self._rows)

    def first(self) -> object | None:
        return self._rows[0] if self._rows else None


class FakeSession:
    def __init__(self, rows_by_model: dict[object, list[object]]) -> None:
        self._rows_by_model = rows_by_model
        self.deleted: list[object] = []
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def query(self, model: object) -> FakeQuery:
        return FakeQuery(self._rows_by_model.get(model, []))

    def delete(self, row: object) -> None:
        self.deleted.append(row)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True

    def flush(self) -> None:
        return None


class SessionFactory:
    def __init__(self, sessions: list[FakeSession]) -> None:
        self._sessions = list(sessions)
        self.calls = 0

    def __call__(self) -> FakeSession:
        session = self._sessions[self.calls]
        self.calls += 1
        return session


def _journey(*, journey_id: object, project_id: object, user_id: object, status: str = "done") -> Journey:
    return Journey(
        id=journey_id,
        project_id=project_id,
        user_id=user_id,
        kind="manuscriptEdit",
        display_label="Journey",
        status=status,
        last_error=None,
    )


def _thread(*, thread_id: object, project_id: object, user_id: object, journey_id: object, status: str) -> Thread:
    return Thread(
        id=thread_id,
        project_id=project_id,
        user_id=user_id,
        thread_type="journey",
        parent_id=journey_id,
        status=status,
    )


def test_delete_all_project_journeys_cancels_active_threads_and_emits_bulk_events(monkeypatch) -> None:
    user_id = uuid4()
    project_id = uuid4()
    journey_a_id = uuid4()
    journey_b_id = uuid4()
    thread_a_id = uuid4()
    thread_b_id = uuid4()
    notif_a_id = uuid4()
    notif_b_id = uuid4()

    journey_a = _journey(journey_id=journey_a_id, project_id=project_id, user_id=user_id, status="running")
    journey_b = _journey(journey_id=journey_b_id, project_id=project_id, user_id=user_id, status="paused")
    thread_a = _thread(thread_id=thread_a_id, project_id=project_id, user_id=user_id, journey_id=journey_a_id, status="running")
    thread_b = _thread(thread_id=thread_b_id, project_id=project_id, user_id=user_id, journey_id=journey_b_id, status="paused")

    discovery_db = FakeSession({Journey: [journey_a, journey_b], Thread: [thread_a, thread_b]})
    delete_db = FakeSession({Journey: [journey_a, journey_b], Thread: [thread_a, thread_b]})
    db_factory = SessionFactory([discovery_db, delete_db])

    canceled_thread_ids: list[object] = []
    emitted_user: list[tuple[str, dict[str, object], object | None]] = []
    emitted_project: list[tuple[str, dict[str, object]]] = []

    async def _fake_cancel_run_for_delete(*, thread_id: object, user_id: object) -> None:
        canceled_thread_ids.append(thread_id)

    async def _fake_emit_user_event(*, user_id: object, event_name: str, data: dict[str, object], project_id: object | None = None) -> None:
        emitted_user.append((event_name, data, project_id))

    async def _fake_emit_project_event(*, user_id: object, project_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted_project.append((event_name, data))

    service = journey_service_module.JourneyService(
        db_factory=db_factory,
        run_pipeline=SimpleNamespace(cancel_run_for_delete=_fake_cancel_run_for_delete),
        event_dispatcher=SimpleNamespace(
            emit_user_event=_fake_emit_user_event,
            emit_project_event=_fake_emit_project_event,
        ),
    )

    notifications_by_source = {
        str(journey_a_id): journey_service_module.NotificationDeleteRow(id=str(notif_a_id), project_id=str(project_id)),
        str(journey_b_id): journey_service_module.NotificationDeleteRow(id=str(notif_b_id), project_id=str(project_id)),
    }

    def _fake_delete_notification_source(_db: object, *, user_id: object, source_kind: str, source_id: object):
        return notifications_by_source.get(str(source_id))

    monkeypatch.setattr(journey_service_module, "delete_notification_source", _fake_delete_notification_source)

    deleted = asyncio.run(
        service.delete_all_project_journeys(
            project_id=project_id,
            user_id=user_id,
        )
    )

    assert deleted == 2
    assert canceled_thread_ids == [thread_a_id]
    assert delete_db.committed is True
    assert delete_db.rolled_back is False
    assert discovery_db.closed is True
    assert delete_db.closed is True
    assert delete_db.deleted == [thread_a, journey_a, thread_b, journey_b]
    assert emitted_user == [
        (
            "notification:bulk_delete",
            {"ids": [str(notif_a_id), str(notif_b_id)]},
            project_id,
        )
    ]
    assert emitted_project == [
        (
            "thread:bulk_delete",
            {"ids": [str(thread_a_id), str(thread_b_id)]},
        )
    ]


def test_delete_all_project_journeys_returns_zero_without_events(monkeypatch) -> None:
    user_id = uuid4()
    project_id = uuid4()
    discovery_db = FakeSession({Journey: [], Thread: []})
    delete_db = FakeSession({Journey: [], Thread: []})
    db_factory = SessionFactory([discovery_db, delete_db])

    canceled_thread_ids: list[object] = []
    emitted_user: list[tuple[str, dict[str, object], object | None]] = []
    emitted_project: list[tuple[str, dict[str, object]]] = []

    async def _fake_cancel_run_for_delete(*, thread_id: object, user_id: object) -> None:
        canceled_thread_ids.append(thread_id)

    async def _fake_emit_user_event(*, user_id: object, event_name: str, data: dict[str, object], project_id: object | None = None) -> None:
        emitted_user.append((event_name, data, project_id))

    async def _fake_emit_project_event(*, user_id: object, project_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted_project.append((event_name, data))

    service = journey_service_module.JourneyService(
        db_factory=db_factory,
        run_pipeline=SimpleNamespace(cancel_run_for_delete=_fake_cancel_run_for_delete),
        event_dispatcher=SimpleNamespace(
            emit_user_event=_fake_emit_user_event,
            emit_project_event=_fake_emit_project_event,
        ),
    )

    def _unexpected_delete_notification_source(*_args, **_kwargs):
        raise AssertionError("delete_notification_source should not be called")

    monkeypatch.setattr(journey_service_module, "delete_notification_source", _unexpected_delete_notification_source)

    deleted = asyncio.run(
        service.delete_all_project_journeys(
            project_id=project_id,
            user_id=user_id,
        )
    )

    assert deleted == 0
    assert canceled_thread_ids == []
    assert emitted_user == []
    assert emitted_project == []
    assert discovery_db.closed is True
    assert delete_db.closed is True
    assert delete_db.committed is False


def test_delete_all_project_journeys_route_returns_deleted_count(monkeypatch) -> None:
    user_id = uuid4()
    project_id = uuid4()
    require_owned_calls: list[tuple[object, object]] = []
    delete_all_calls: list[tuple[object, object]] = []

    def _fake_require_owned_project(_db: object, *, project_id: object, user_id: object) -> None:
        require_owned_calls.append((project_id, user_id))

    async def _fake_delete_all_project_journeys(*, project_id: object, user_id: object) -> int:
        delete_all_calls.append((project_id, user_id))
        return 3

    monkeypatch.setattr(journey_routes, "require_owned_project", _fake_require_owned_project)
    monkeypatch.setattr(journey_routes.journey_service, "delete_all_project_journeys", _fake_delete_all_project_journeys)

    response = asyncio.run(
        journey_routes.delete_all_project_journeys(
            project_id=project_id,
            current_user=SimpleNamespace(id=user_id),
            db=object(),
        )
    )

    assert response.deleted == 3
    assert require_owned_calls == [(project_id, user_id)]
    assert delete_all_calls == [(project_id, user_id)]

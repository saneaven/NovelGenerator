from __future__ import annotations

import asyncio
import os
import sys
import types
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import declarative_base

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    fake_auth = types.ModuleType("App.backend.auth")
    fake_auth.get_current_user = lambda: None
    sys.modules["App.backend.auth"] = fake_auth

    fake_chat_attachment_service = types.ModuleType("App.backend.services.chat_attachment_service")

    class ChatAttachmentValidationError(ValueError):
        def __init__(self, message: str, *, status_code: int = 422) -> None:
            super().__init__(message)
            self.status_code = status_code

    @dataclass(frozen=True)
    class IncomingMessageAttachment:
        filename: str
        mime_type: str
        content: bytes

    fake_chat_attachment_service.ChatAttachmentValidationError = ChatAttachmentValidationError
    fake_chat_attachment_service.IncomingMessageAttachment = IncomingMessageAttachment
    fake_chat_attachment_service.chat_attachment_service = SimpleNamespace(
        serialize_attachment=lambda row: row,
    )
    sys.modules["App.backend.services.chat_attachment_service"] = fake_chat_attachment_service

    fake_deletion_service = types.ModuleType("App.backend.services.deletion_service")
    fake_deletion_service.delete_chat_attachments_with_files = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.deletion_service"] = fake_deletion_service

    fake_run_event_bus = types.ModuleType("App.backend.services.run_event_bus")
    fake_run_event_bus.run_event_bus = SimpleNamespace(subscribe=lambda *_args, **_kwargs: [])
    sys.modules["App.backend.services.run_event_bus"] = fake_run_event_bus

    async def _emit_runtime_event(*_args, **_kwargs):
        return None

    async def _emit_project_event(*_args, **_kwargs):
        return None

    fake_runtime_event_dispatcher = types.ModuleType("App.backend.services.runtime_event_dispatcher")
    fake_runtime_event_dispatcher.runtime_event_dispatcher = SimpleNamespace(
        emit_runtime_event=_emit_runtime_event,
        emit_project_event=_emit_project_event,
    )
    sys.modules["App.backend.services.runtime_event_dispatcher"] = fake_runtime_event_dispatcher

    fake_notification_service = types.ModuleType("App.backend.services.notification_service")
    fake_notification_service.default_journey_label = lambda *_args, **_kwargs: "Journey"
    fake_notification_service.message_from_notification_status = lambda *_args, **_kwargs: ""
    fake_notification_service.serialize_notification = lambda *_args, **_kwargs: {}
    fake_notification_service.upsert_notification = lambda *_args, **_kwargs: None
    fake_notification_service.ACTIVE_THREAD_DELETE_STATUSES = {"running", "waiting", "processing"}
    fake_notification_service.NotificationSourceSnapshot = SimpleNamespace
    fake_notification_service.collect_thread_delete_deltas = lambda *_args, **_kwargs: []
    fake_notification_service.delete_threads = lambda *_args, **_kwargs: None
    fake_notification_service.map_run_status_to_notification_status = lambda status: status
    fake_notification_service.upsert_notification_source = lambda *_args, **_kwargs: None
    fake_notification_service.build_journey_notification_snapshot = lambda **kwargs: SimpleNamespace(
        user_id=getattr(kwargs.get("journey"), "user_id", None),
        project_id=getattr(kwargs.get("journey"), "project_id", None),
        source_kind="journey",
        source_id=str(getattr(kwargs.get("journey"), "id", "")),
        status=str(getattr(kwargs.get("run"), "status", "")),
        label="Journey",
        message="",
        important=False,
        target={"kind": "journey"},
        warning=None,
        progress=None,
        custom_slot={"type": "none"},
        meta={},
    )
    sys.modules["App.backend.services.notification_service"] = fake_notification_service

    fake_run_pipeline_status_logic = types.ModuleType("App.backend.services.run_pipeline.status_logic")
    fake_run_pipeline_status_logic.derive_run_status = lambda *, current_status, tool_call_statuses: current_status
    sys.modules["App.backend.services.run_pipeline.status_logic"] = fake_run_pipeline_status_logic

    fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
    fake_run_pipeline.run_pipeline = SimpleNamespace(
        start_run=lambda *_args, **_kwargs: None,
        resume_run=lambda *_args, **_kwargs: None,
        pause_run=lambda *_args, **_kwargs: None,
        cancel_run=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

    fake_tool_engine = types.ModuleType("App.backend.services.tool_engine")
    fake_tool_engine.tool_engine = SimpleNamespace(
        execute_tool_call_by_id=lambda *_args, **_kwargs: {},
        propagate_child_terminal_state_to_parent=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.tool_engine"] = fake_tool_engine

    fake_sidecar_client = types.ModuleType("App.backend.services.sidecar_client")
    fake_sidecar_client.sidecar_client = SimpleNamespace()
    sys.modules["App.backend.services.sidecar_client"] = fake_sidecar_client

    fake_reasoning_normalize = types.ModuleType("App.backend.services.reasoning.normalize")
    fake_reasoning_normalize.normalize_reasoning_detail = lambda value: value
    sys.modules["App.backend.services.reasoning.normalize"] = fake_reasoning_normalize

    fake_ownership = types.ModuleType("App.backend.services.ownership")
    fake_ownership.require_owned_project = lambda *_args, **_kwargs: None
    fake_ownership.require_owned_thread = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.ownership"] = fake_ownership

    fake_image_run_service = types.ModuleType("App.backend.services.image_run_service")
    fake_image_run_service.image_run_service = SimpleNamespace(
        start_run=lambda *_args, **_kwargs: None,
        fail_run=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.image_run_service"] = fake_image_run_service

    fake_storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")

    class StorageQuotaExceededError(Exception):
        pass

    fake_storage_usage_service.StorageQuotaExceededError = StorageQuotaExceededError
    fake_storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_notification_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_run_message_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_run_message_attachment_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_thread_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_tool_call_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.enforce_user_storage_quota = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_notification_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_run_message_attachment_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_run_message_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_thread_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_tool_call_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_rows = lambda rows, _snapshot_fn: list(rows)
    sys.modules["App.backend.services.storage_usage_service"] = fake_storage_usage_service


_install_import_stubs()

from App.backend.routes import thread_routes


class FakeJsonRequest:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload
        self.headers = {"content-type": "application/json"}

    async def json(self) -> dict[str, object]:
        return self._payload


class FakeUpload:
    def __init__(self, *, filename: str, content_type: str, content: bytes) -> None:
        self.filename = filename
        self.content_type = content_type
        self._content = content

    async def read(self) -> bytes:
        return self._content


class FakeForm:
    def __init__(self, *, fields: dict[str, object], attachments: list[FakeUpload]) -> None:
        self._fields = fields
        self._attachments = attachments

    def get(self, key: str, default: object = None) -> object:
        return self._fields.get(key, default)

    def getlist(self, key: str) -> list[FakeUpload]:
        if key != "attachments":
            return []
        return list(self._attachments)


class FakeMultipartRequest:
    def __init__(self, *, fields: dict[str, object], attachments: list[FakeUpload]) -> None:
        self._form = FakeForm(fields=fields, attachments=attachments)
        self.headers = {"content-type": "multipart/form-data; boundary=test"}

    async def form(self) -> FakeForm:
        return self._form


def _make_run(*, thread_id, user_id, status: str = "running", thread_status: str = "running"):
    thread = SimpleNamespace(id=thread_id, user_id=user_id, status=thread_status)
    return SimpleNamespace(id=uuid4(), status=status, thread=thread)


def test_start_thread_run_passes_text_payload_to_start_run(monkeypatch: pytest.MonkeyPatch) -> None:
    thread_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}

    async def _fake_start_run(**kwargs):
        captured.update(kwargs)
        return _make_run(thread_id=thread_id, user_id=user_id)

    monkeypatch.setattr(thread_routes.run_pipeline, "start_run", _fake_start_run)

    response = asyncio.run(
        thread_routes.start_thread_run(
            thread_id=thread_id,
            request=FakeJsonRequest(
                {
                    "input_text": "hello",
                    "run_mode": "agentMode",
                    "surface": "workspace",
                    "context_object_ids": [str(uuid4())],
                    "journey_target_ids": [str(uuid4())],
                    "language": "English",
                }
            ),
            current_user=SimpleNamespace(id=user_id),
            db=None,
        )
    )

    assert response.thread_id == thread_id
    assert captured["thread_id"] == thread_id
    assert captured["user_id"] == user_id
    assert captured["input_text"] == "hello"
    assert captured["attachments"] == []
    assert captured["mcp_selections"] == []


def test_start_thread_run_passes_multipart_attachments_to_start_run(monkeypatch: pytest.MonkeyPatch) -> None:
    thread_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}

    async def _fake_start_run(**kwargs):
        captured.update(kwargs)
        return _make_run(thread_id=thread_id, user_id=user_id)

    monkeypatch.setattr(thread_routes.run_pipeline, "start_run", _fake_start_run)

    response = asyncio.run(
        thread_routes.start_thread_run(
            thread_id=thread_id,
            request=FakeMultipartRequest(
                fields={"input_text": "", "language": "English"},
                attachments=[
                    FakeUpload(filename="note.txt", content_type="text/plain", content=b"attachment-body"),
                ],
            ),
            current_user=SimpleNamespace(id=user_id),
            db=None,
        )
    )

    attachments = captured["attachments"]

    assert response.thread_id == thread_id
    assert isinstance(attachments, list)
    assert len(attachments) == 1
    assert attachments[0].filename == "note.txt"
    assert attachments[0].mime_type == "text/plain"
    assert attachments[0].content == b"attachment-body"


def test_start_thread_run_passes_mcp_only_payload_to_start_run(monkeypatch: pytest.MonkeyPatch) -> None:
    thread_id = uuid4()
    user_id = uuid4()
    server_id = uuid4()
    captured: dict[str, object] = {}

    async def _fake_start_run(**kwargs):
        captured.update(kwargs)
        return _make_run(thread_id=thread_id, user_id=user_id)

    monkeypatch.setattr(thread_routes.run_pipeline, "start_run", _fake_start_run)

    response = asyncio.run(
        thread_routes.start_thread_run(
            thread_id=thread_id,
            request=FakeJsonRequest(
                {
                    "input_text": "",
                    "mcp_selections": [
                        {
                            "selection_id": "sel-1",
                            "server_id": str(server_id),
                            "kind": "resource",
                            "resource_uri": "file://chapter-1",
                        }
                    ],
                }
            ),
            current_user=SimpleNamespace(id=user_id),
            db=None,
        )
    )

    selections = captured["mcp_selections"]

    assert response.thread_id == thread_id
    assert isinstance(selections, list)
    assert len(selections) == 1
    assert selections[0].selection_id == "sel-1"
    assert str(selections[0].server_id) == str(server_id)


def test_start_thread_run_propagates_empty_request_400(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_start_run(**_kwargs):
        raise HTTPException(
            status_code=400,
            detail="input_text, attachments, or mcp_selections are required for create run",
        )

    monkeypatch.setattr(thread_routes.run_pipeline, "start_run", _fake_start_run)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            thread_routes.start_thread_run(
                thread_id=uuid4(),
                request=FakeJsonRequest({"input_text": ""}),
                current_user=SimpleNamespace(id=uuid4()),
                db=None,
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "input_text, attachments, or mcp_selections are required for create run"


def test_start_thread_run_rejects_json_attachments_field_with_422() -> None:
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            thread_routes.start_thread_run(
                thread_id=uuid4(),
                request=FakeJsonRequest(
                    {
                        "input_text": "hello",
                        "attachments": [],
                    }
                ),
                current_user=SimpleNamespace(id=uuid4()),
                db=None,
            )
        )

    assert exc_info.value.status_code == 422
    assert isinstance(exc_info.value.detail, list)
    assert exc_info.value.detail[0]["loc"] == ["body", "attachments"]
    assert exc_info.value.detail[0]["type"] == "extra_forbidden"


def test_start_thread_run_rejects_other_unexpected_json_field_with_422() -> None:
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            thread_routes.start_thread_run(
                thread_id=uuid4(),
                request=FakeJsonRequest(
                    {
                        "input_text": "hello",
                        "unexpected_flag": True,
                    }
                ),
                current_user=SimpleNamespace(id=uuid4()),
                db=None,
            )
        )

    assert exc_info.value.status_code == 422
    assert isinstance(exc_info.value.detail, list)
    assert exc_info.value.detail[0]["loc"] == ["body", "unexpected_flag"]
    assert exc_info.value.detail[0]["type"] == "extra_forbidden"


def test_resume_thread_run_passes_request_to_resume_run(monkeypatch: pytest.MonkeyPatch) -> None:
    thread_id = uuid4()
    user_id = uuid4()
    context_object_id = uuid4()
    journey_target_id = uuid4()
    captured: dict[str, object] = {}

    async def _fake_resume_run(**kwargs):
        captured.update(kwargs)
        return _make_run(thread_id=thread_id, user_id=user_id, status="done", thread_status="done")

    monkeypatch.setattr(thread_routes.run_pipeline, "resume_run", _fake_resume_run)

    response = asyncio.run(
        thread_routes.resume_thread_run(
            thread_id=thread_id,
            payload=thread_routes.ResumeRunRequest(
                run_mode="planMode",
                surface="workspace",
                context_object_ids=[context_object_id],
                journey_target_ids=[journey_target_id],
                language="Korean",
            ),
            current_user=SimpleNamespace(id=user_id),
            db=None,
        )
    )

    assert response.thread_id == thread_id
    assert response.thread_status == "done"
    assert captured["thread_id"] == thread_id
    assert captured["user_id"] == user_id
    assert captured["run_mode"] == "planMode"
    assert captured["surface"] == "workspace"
    assert captured["context_object_ids"] == [context_object_id]
    assert captured["journey_target_ids"] == [journey_target_id]
    assert captured["language"] == "Korean"


class FakeListThreadMessagesQuery:
    def __init__(self, db: "FakeListThreadMessagesDb", target: object) -> None:
        self.db = db
        self.target = target

    def filter(self, *_args, **_kwargs) -> "FakeListThreadMessagesQuery":
        return self

    def order_by(self, *_args, **_kwargs) -> "FakeListThreadMessagesQuery":
        return self

    def all(self) -> list[object]:
        if self.target is thread_routes.RunMessageModel:
            return list(self.db.messages)
        if self.target is thread_routes.RunMessageAttachmentModel:
            return list(self.db.attachments)
        if self.target is thread_routes.RunToolCallModel:
            return list(self.db.tool_calls)
        raise AssertionError(f"Unsupported all() target: {self.target!r}")

    def first(self):
        if self.target is thread_routes.RunModel:
            return self.db.latest_run
        if _is_column_for(self.target, thread_routes.MessageMemorySummary, "to_message_id"):
            return self.db.boundary_row
        raise AssertionError(f"Unsupported first() target: {self.target!r}")


class FakeListThreadMessagesDb:
    def __init__(self, *, latest_run: SimpleNamespace, boundary_row: tuple[object] | None = None) -> None:
        self.latest_run = latest_run
        self.messages: list[object] = []
        self.attachments: list[object] = []
        self.tool_calls: list[object] = []
        self.boundary_row = boundary_row

    def query(self, target: object) -> FakeListThreadMessagesQuery:
        return FakeListThreadMessagesQuery(self, target)


def test_list_thread_messages_serializes_latest_run_context_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    thread_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    parent_id = uuid4()
    created_at = datetime.now(UTC)
    updated_at = datetime.now(UTC)
    thread = SimpleNamespace(
        id=thread_id,
        project_id=project_id,
        user_id=user_id,
        thread_type="journey",
        status="error",
        created_at=created_at,
        updated_at=updated_at,
    )
    latest_run = SimpleNamespace(
        id=uuid4(),
        status="error",
        run_seq=7,
        language="Korean",
        run_mode="planMode",
        surface="story-entity",
        created_at=created_at,
        updated_at=updated_at,
        input_payload={"userRequest": "revise tone"},
        context_object_ids=[str(uuid4()), str(uuid4())],
        journey_target_ids=[str(uuid4())],
    )
    db = FakeListThreadMessagesDb(latest_run=latest_run)

    monkeypatch.setattr(thread_routes, "require_owned_thread", lambda *_args, **_kwargs: thread)
    monkeypatch.setattr(
        thread_routes,
        "thread_runtime_fields",
        lambda *_args, **_kwargs: {
            "parent_id": parent_id,
            "journey_kind": "objectEdit",
            "display_label": "Journey",
        },
    )
    monkeypatch.setattr(
        thread_routes.image_run_service,
        "list_thread_runs",
        lambda *_args, **_kwargs: [],
        raising=False,
    )

    response = asyncio.run(
        thread_routes.list_thread_messages(
            thread_id=thread_id,
            current_user=SimpleNamespace(id=user_id),
            db=db,  # type: ignore[arg-type]
        )
    )

    assert response.latest_run is not None
    assert response.latest_run["input_payload"] == latest_run.input_payload
    assert response.latest_run["context_object_ids"] == latest_run.context_object_ids
    assert response.latest_run["journey_target_ids"] == latest_run.journey_target_ids
    assert response.latest_run["language"] == "Korean"
    assert response.latest_run["run_mode"] == "planMode"
    assert response.latest_run["surface"] == "story-entity"


def _is_column_for(target: object, model: object, key: str) -> bool:
    return getattr(target, "class_", None) is model and getattr(target, "key", None) == key


class FakeDeletePauseQuery:
    def __init__(self, db: "FakeDeletePauseDb", target: object) -> None:
        self.db = db
        self.target = target
        self._ordered = False

    def filter(self, *_args, **_kwargs) -> "FakeDeletePauseQuery":
        return self

    def order_by(self, *_args, **_kwargs) -> "FakeDeletePauseQuery":
        self._ordered = True
        return self

    def all(self) -> list[tuple[str]]:
        if _is_column_for(self.target, thread_routes.RunToolCallModel, "status"):
            return [(status,) for status in self.db.tool_statuses]
        raise AssertionError(f"Unsupported all() target: {self.target!r}")

    def first(self):
        if self.target is thread_routes.RunModel:
            return self.db.latest_run if self._ordered else self.db.run
        raise AssertionError(f"Unsupported first() target: {self.target!r}")


class FakeDeletePauseDb:
    def __init__(
        self,
        *,
        thread_status: str,
        run_status: str,
        tool_statuses: list[str],
        latest_run_matches: bool = True,
    ) -> None:
        self.thread = SimpleNamespace(id=uuid4(), status=thread_status)
        self.run = SimpleNamespace(
            id=uuid4(),
            thread=self.thread,
            thread_id=self.thread.id,
            run_seq=1,
            status=run_status,
        )
        self.latest_run = self.run if latest_run_matches else SimpleNamespace(id=uuid4(), thread_id=self.thread.id, run_seq=2)
        self.tool_statuses = list(tool_statuses)

    def query(self, target: object) -> FakeDeletePauseQuery:
        return FakeDeletePauseQuery(self, target)


@pytest.mark.parametrize(
    ("thread_status", "run_status", "tool_statuses"),
    [
        ("waiting", "waiting", ["applied"]),
        ("processing", "processing", ["failed"]),
    ],
)
def test_pause_run_after_delete_if_needed_marks_thread_paused_when_last_unresolved_removed(
    thread_status: str,
    run_status: str,
    tool_statuses: list[str],
) -> None:
    db = FakeDeletePauseDb(
        thread_status=thread_status,
        run_status=run_status,
        tool_statuses=tool_statuses,
    )

    run, thread, paused = thread_routes._pause_run_after_delete_if_needed(
        db,
        run_id=db.run.id,
        previous_thread_status=thread_status,
        previous_unresolved_count=1,
    )

    assert paused is True
    assert run is db.run
    assert thread is db.thread
    assert db.run.status == "paused"
    assert db.thread.status == "paused"


def test_pause_run_after_delete_if_needed_does_not_pause_when_unresolved_tool_calls_remain() -> None:
    db = FakeDeletePauseDb(
        thread_status="waiting",
        run_status="waiting",
        tool_statuses=["pending"],
    )

    run, thread, paused = thread_routes._pause_run_after_delete_if_needed(
        db,
        run_id=db.run.id,
        previous_thread_status="waiting",
        previous_unresolved_count=2,
    )

    assert paused is False
    assert run is db.run
    assert thread is db.thread
    assert db.run.status == "waiting"
    assert db.thread.status == "waiting"


def test_pause_run_after_delete_if_needed_does_not_pause_done_thread() -> None:
    db = FakeDeletePauseDb(
        thread_status="done",
        run_status="done",
        tool_statuses=[],
    )

    run, thread, paused = thread_routes._pause_run_after_delete_if_needed(
        db,
        run_id=db.run.id,
        previous_thread_status="done",
        previous_unresolved_count=1,
    )

    assert paused is False
    assert run is None
    assert thread is None
    assert db.run.status == "done"
    assert db.thread.status == "done"


class FakeDeleteMessageRouteQuery:
    def __init__(self, db: "FakeDeleteMessageRouteDb", target: object) -> None:
        self.db = db
        self.target = target
        self._ordered = False

    def filter(self, *_args, **_kwargs) -> "FakeDeleteMessageRouteQuery":
        return self

    def order_by(self, *_args, **_kwargs) -> "FakeDeleteMessageRouteQuery":
        self._ordered = True
        return self

    def all(self) -> list[object]:
        if self.target is thread_routes.RunMessageAttachmentModel:
            return []
        raise AssertionError(f"Unsupported all() target: {self.target!r}")

    def first(self):
        if self.target is thread_routes.RunMessageModel:
            if self.db.message in self.db.deleted:
                return None
            return self.db.message
        if self.target is thread_routes.RunModel:
            return self.db.latest_run if self._ordered else self.db.run
        raise AssertionError(f"Unsupported first() target: {self.target!r}")


class FakeDeleteMessageRouteDb:
    def __init__(self, *, thread: SimpleNamespace, run: SimpleNamespace, message: SimpleNamespace) -> None:
        self.thread = thread
        self.run = run
        self.message = message
        self.latest_run = run
        self.deleted: list[object] = []
        self.committed = False
        self.flushed = False

    def query(self, target: object) -> FakeDeleteMessageRouteQuery:
        return FakeDeleteMessageRouteQuery(self, target)

    def delete(self, row: object) -> None:
        self.deleted.append(row)

    def flush(self) -> None:
        self.flushed = True

    def commit(self) -> None:
        self.committed = True


def test_delete_thread_message_pauses_thread_and_emits_snapshot_invalidation(monkeypatch: pytest.MonkeyPatch) -> None:
    thread_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    message_id = uuid4()
    thread = SimpleNamespace(
        id=thread_id,
        user_id=user_id,
        project_id=project_id,
        status="waiting",
        captured_history_conversation_json=None,
    )
    run = SimpleNamespace(
        id=run_id,
        thread=thread,
        thread_id=thread_id,
        run_seq=1,
        status="waiting",
        error=None,
    )
    message = SimpleNamespace(
        id=message_id,
        thread_id=thread_id,
        run_id=run_id,
        role="assistant",
        data={},
    )
    db = FakeDeleteMessageRouteDb(thread=thread, run=run, message=message)
    emitted: list[tuple[str, dict[str, object]]] = []
    unresolved_counts = iter([1, 0])

    monkeypatch.setattr(thread_routes, "require_owned_thread", lambda *_args, **_kwargs: thread)
    monkeypatch.setattr(thread_routes, "_snapshot_assistant_tool_call_tree", lambda *_args, **_kwargs: ([], []))
    monkeypatch.setattr(
        thread_routes,
        "_count_unresolved_run_tool_calls",
        lambda *_args, **_kwargs: next(unresolved_counts),
    )
    monkeypatch.setattr(thread_routes, "snapshot_thread_row", lambda row: {"status": row.status})
    monkeypatch.setattr(thread_routes, "snapshot_run_message_row", lambda row: {"id": str(row.id)})
    monkeypatch.setattr(thread_routes, "build_thread_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(thread_routes, "build_run_message_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(thread_routes, "build_run_message_attachment_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(thread_routes, "build_tool_call_delta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(thread_routes, "apply_project_usage_deltas", lambda *_args, **_kwargs: None)

    async def _fake_emit_runtime_event(*, event_name: str, data: dict[str, object], **_kwargs):
        emitted.append((event_name, data))
        return {"event": event_name, "data": data}

    monkeypatch.setattr(
        thread_routes.runtime_event_dispatcher,
        "emit_runtime_event",
        _fake_emit_runtime_event,
    )

    response = asyncio.run(
        thread_routes.delete_thread_message(
            thread_id=thread_id,
            message_id=message_id,
            current_user=SimpleNamespace(id=user_id),
            db=db,  # type: ignore[arg-type]
        )
    )

    assert response.status_code == 204
    assert db.flushed is True
    assert db.committed is True
    assert run.status == "paused"
    assert thread.status == "paused"
    assert [name for name, _ in emitted] == ["run:status", "thread:snapshot_invalidated"]
    assert emitted[0][1]["status"] == "paused"
    assert emitted[1][1]["run_id"] == str(run_id)



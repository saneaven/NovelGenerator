from __future__ import annotations

import asyncio
import os
import sys
import types
from dataclasses import dataclass
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

    fake_runtime_event_dispatcher = types.ModuleType("App.backend.services.runtime_event_dispatcher")
    fake_runtime_event_dispatcher.runtime_event_dispatcher = SimpleNamespace(
        emit_runtime_event=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.runtime_event_dispatcher"] = fake_runtime_event_dispatcher

    fake_notification_service = types.ModuleType("App.backend.services.notification_service")
    fake_notification_service.default_journey_label = lambda *_args, **_kwargs: "Journey"
    fake_notification_service.message_from_notification_status = lambda *_args, **_kwargs: ""
    fake_notification_service.serialize_notification = lambda *_args, **_kwargs: {}
    fake_notification_service.upsert_notification = lambda *_args, **_kwargs: None
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
    fake_tool_engine.tool_engine = SimpleNamespace(execute_tool_call_by_id=lambda *_args, **_kwargs: {})
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

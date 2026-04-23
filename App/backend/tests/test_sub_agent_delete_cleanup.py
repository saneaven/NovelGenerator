from __future__ import annotations

import asyncio
import os
import sys
import types
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")


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

    fake_demo_policy = types.ModuleType("App.backend.services.demo_policy")
    fake_demo_policy.require_demo_off = lambda: None
    sys.modules["App.backend.services.demo_policy"] = fake_demo_policy

    fake_chat_attachment_service = types.ModuleType("App.backend.services.chat_attachment_service")
    fake_chat_attachment_service.ChatAttachmentValidationError = ValueError
    fake_chat_attachment_service.IncomingMessageAttachment = object
    fake_chat_attachment_service.chat_attachment_service = SimpleNamespace(
        ingest_message_attachments=lambda *_args, **_kwargs: [],
        serialize_attachment=lambda row: row,
    )
    sys.modules["App.backend.services.chat_attachment_service"] = fake_chat_attachment_service

    fake_tool_engine = types.ModuleType("App.backend.services.tool_engine")
    fake_tool_engine.__path__ = []  # type: ignore[attr-defined]
    fake_tool_engine.tool_engine = SimpleNamespace(
        _registry=SimpleNamespace(list_static_tool_names=lambda *_args, **_kwargs: []),
        propagate_child_terminal_state_to_parent=lambda *_args, **_kwargs: None,
        complete_parent_tool_call=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.tool_engine"] = fake_tool_engine

    fake_tool_engine_grant_catalog = types.ModuleType("App.backend.services.tool_engine.grant_catalog")
    fake_tool_engine_grant_catalog.FeatureKey = str
    fake_tool_engine_grant_catalog.ToolCategory = str
    fake_tool_engine_grant_catalog.TOOL_GRANT_CATALOG = {}
    fake_tool_engine_grant_catalog.ordered_feature_keys = lambda: []
    sys.modules["App.backend.services.tool_engine.grant_catalog"] = fake_tool_engine_grant_catalog

    fake_tool_engine_contracts = types.ModuleType("App.backend.services.tool_engine.contracts")
    fake_tool_engine_contracts.ToolOffer = object
    sys.modules["App.backend.services.tool_engine.contracts"] = fake_tool_engine_contracts

    fake_settings_service = types.ModuleType("App.backend.services.settings_service")
    fake_settings_service.settings_service = SimpleNamespace(_get_settings=lambda *_args, **_kwargs: SimpleNamespace())
    sys.modules["App.backend.services.settings_service"] = fake_settings_service

    fake_mcp = types.ModuleType("App.backend.services.mcp")
    fake_mcp.mcp_policy_service = SimpleNamespace(build_runtime_context=lambda *_args, **_kwargs: None)
    fake_mcp.mcp_resolver = SimpleNamespace(resolve_selections=lambda *_args, **_kwargs: None)
    sys.modules["App.backend.services.mcp"] = fake_mcp

    fake_storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")

    class _FakeDelta:
        def __init__(self, *, chat_bytes: int = 0, image_run_bytes: int = 0, notification_bytes: int = 0) -> None:
            self.chat_bytes = chat_bytes
            self.image_run_bytes = image_run_bytes
            self.notification_bytes = notification_bytes

    class StorageQuotaExceededError(Exception):
        pass

    fake_storage_usage_service.StorageQuotaExceededError = StorageQuotaExceededError
    fake_storage_usage_service.StorageUsageDelta = _FakeDelta
    fake_storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_image_run_delta = lambda *_args, **_kwargs: _FakeDelta(image_run_bytes=-1)
    fake_storage_usage_service.build_notification_delta = lambda *_args, **_kwargs: _FakeDelta(notification_bytes=-1)
    fake_storage_usage_service.build_run_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_run_message_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_run_message_attachment_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_thread_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_tool_call_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.snapshot_image_run_row = lambda row: row
    fake_storage_usage_service.snapshot_notification_row = lambda row: row
    fake_storage_usage_service.snapshot_run_message_attachment_row = lambda row: row
    fake_storage_usage_service.snapshot_run_message_row = lambda row: row
    fake_storage_usage_service.snapshot_run_row = lambda row: row
    fake_storage_usage_service.snapshot_thread_row = lambda row: row
    fake_storage_usage_service.snapshot_tool_call_row = lambda row: row
    sys.modules["App.backend.services.storage_usage_service"] = fake_storage_usage_service

    fake_template_engine = types.ModuleType("App.backend.services.template_engine")

    class FragmentNotFoundError(RuntimeError):
        pass

    class TemplateRenderLimitError(RuntimeError):
        pass

    fake_template_engine.FragmentNotFoundError = FragmentNotFoundError
    fake_template_engine.TemplateRenderLimitError = TemplateRenderLimitError
    fake_template_engine.format_template_error = lambda exc: str(exc)
    sys.modules["App.backend.services.template_engine"] = fake_template_engine

    fake_runtime_event_dispatcher = types.ModuleType("App.backend.services.runtime_event_dispatcher")
    fake_runtime_event_dispatcher.RuntimeEventDispatcher = object
    fake_runtime_event_dispatcher.runtime_event_dispatcher = SimpleNamespace(emit_project_event=lambda *_args, **_kwargs: None)
    sys.modules["App.backend.services.runtime_event_dispatcher"] = fake_runtime_event_dispatcher

    fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
    fake_llm_execution.__path__ = []  # type: ignore[attr-defined]

    class LLMExecutionOrchestrator:
        async def execute(self, *_args, **_kwargs) -> None:
            return None

    fake_llm_execution.ExecutionCheckpoint = object
    fake_llm_execution.LLMExecutionCallbacks = object
    fake_llm_execution.LLMExecutionRequest = object
    fake_llm_execution.LLMExecutionOrchestrator = LLMExecutionOrchestrator
    sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution

    fake_llm_execution_orchestrator = types.ModuleType("App.backend.services.run_pipeline.llm_execution.orchestrator")
    fake_llm_execution_orchestrator.LLMExecutionOrchestrator = LLMExecutionOrchestrator
    sys.modules["App.backend.services.run_pipeline.llm_execution.orchestrator"] = fake_llm_execution_orchestrator

    fake_prompt_assembly = types.ModuleType("App.backend.services.run_pipeline.prompt_assembly")
    fake_prompt_assembly.assemble_create = lambda *_args, **_kwargs: ("", [], {})
    fake_prompt_assembly.assemble_resume = lambda *_args, **_kwargs: ("", [], {})
    sys.modules["App.backend.services.run_pipeline.prompt_assembly"] = fake_prompt_assembly

    for module_name in (
        "App.backend.providers.shared.async_openai_provider",
        "App.backend.providers.claude.llm",
        "App.backend.providers.gemini.llm",
        "App.backend.providers.openai.llm",
        "App.backend.providers.openrouter.llm",
        "App.backend.providers.xai.llm",
        "App.backend.providers.custom.llm",
    ):
        sys.modules[module_name] = types.ModuleType(module_name)


_install_import_stubs()

from App.backend.models.db_models import ImageRunModel, RunMessageModel, RunModel, RunToolCallModel, Thread
from App.backend.routes import sub_agent_routes
from App.backend.services import notification_service as notification_service_service


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


class FakeRouteDb:
    def __init__(self) -> None:
        self.expired = False
        self.committed = False

    def expire_all(self) -> None:
        self.expired = True

    def commit(self) -> None:
        self.committed = True


def test_collect_thread_delete_deltas_groups_graph_by_project() -> None:
    user_id = uuid4()
    project_a = uuid4()
    project_b = uuid4()
    thread_a = uuid4()
    thread_b = uuid4()
    now = datetime(2026, 3, 10, 12, 0, 0)

    db = FakeCollectionDb(
        {
            Thread: [
                SimpleNamespace(
                    id=thread_a,
                    user_id=user_id,
                    project_id=project_a,
                    thread_type="subAgent",
                    captured_prompt_snapshot={"systemPrompt": "a", "segments": [{"messages": [{"role": "assistant", "content": "done"}]}]},
                ),
                SimpleNamespace(
                    id=thread_b,
                    user_id=user_id,
                    project_id=project_b,
                    thread_type="subAgent",
                    captured_prompt_snapshot={"systemPrompt": "b", "segments": [{"messages": [{"role": "assistant", "content": "done"}]}]},
                ),
            ],
            RunModel: [
                SimpleNamespace(
                    thread_id=thread_a,
                    error="boom-a",
                    context_object_ids=["obj-a"],
                    journey_target_ids=[],
                    input_payload={"prompt": "alpha"},
                ),
                SimpleNamespace(
                    thread_id=thread_b,
                    error="boom-b",
                    context_object_ids=["obj-b"],
                    journey_target_ids=[],
                    input_payload={"prompt": "beta"},
                ),
            ],
            RunMessageModel: [
                SimpleNamespace(thread_id=thread_a, data={"English": {"contentParts": [{"type": "content", "text": "a"}]}}),
                SimpleNamespace(thread_id=thread_b, data={"English": {"contentParts": [{"type": "content", "text": "b"}]}}),
            ],
            RunToolCallModel: [
                SimpleNamespace(thread_id=thread_a, arguments={"kind": "a"}, extra_content={"preview": True}, reason="cleanup-a", result={"ok": True}),
                SimpleNamespace(thread_id=thread_b, arguments={"kind": "b"}, extra_content={"preview": True}, reason="cleanup-b", result={"ok": True}),
            ],
            ImageRunModel: [
                SimpleNamespace(
                    thread_id=thread_a,
                    request_snapshot={"prompt": "scene-a"},
                    revised_prompt="scene-a revised",
                    before_excerpt="before-a",
                    after_excerpt="after-a",
                    failure_code=None,
                    error_message=None,
                    created_at=now,
                    updated_at=now,
                ),
                SimpleNamespace(
                    thread_id=thread_b,
                    request_snapshot={"prompt": "scene-b"},
                    revised_prompt="scene-b revised",
                    before_excerpt="before-b",
                    after_excerpt="after-b",
                    failure_code=None,
                    error_message=None,
                    created_at=now,
                    updated_at=now,
                ),
            ],
        }
    )

    deltas_by_project = notification_service_service.collect_thread_delete_deltas(
        db,
        user_id=user_id,
        thread_ids=[thread_a, thread_b],
        thread_type="subAgent",
    )

    assert set(deltas_by_project) == {project_a, project_b}
    assert len(deltas_by_project[project_a]) == 5
    assert len(deltas_by_project[project_b]) == 5
    assert sum(1 for delta in deltas_by_project[project_a] if delta.chat_bytes < 0) == 4
    assert sum(1 for delta in deltas_by_project[project_a] if delta.image_run_bytes < 0) == 1
    assert sum(1 for delta in deltas_by_project[project_b] if delta.chat_bytes < 0) == 4
    assert sum(1 for delta in deltas_by_project[project_b] if delta.image_run_bytes < 0) == 1


def test_delete_sub_agent_without_threads_commits_without_events(monkeypatch) -> None:
    user_id = uuid4()
    preset_id = uuid4()
    sub_agent_id = uuid4()
    db = FakeRouteDb()
    delete_calls: list[tuple[object, object]] = []
    emitted: list[tuple[str, dict[str, object]]] = []
    applied: list[tuple[object, list[object]]] = []

    monkeypatch.setattr(sub_agent_routes, "get_active_preset_id", lambda *_args, **_kwargs: preset_id)
    monkeypatch.setattr(sub_agent_routes.sub_agent_service, "list_sub_agent_threads", lambda *_args, **_kwargs: [])

    def _fake_delete_sub_agent(*_args, **kwargs) -> None:
        delete_calls.append((kwargs["sub_agent_id"], kwargs["commit"]))

    monkeypatch.setattr(sub_agent_routes.sub_agent_service, "delete_sub_agent", _fake_delete_sub_agent)
    monkeypatch.setattr(sub_agent_routes, "collect_thread_delete_deltas", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(sub_agent_routes, "delete_threads", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        sub_agent_routes,
        "apply_project_usage_deltas",
        lambda *_args, **_kwargs: applied.append((_kwargs["project_id"], list(_kwargs["deltas"]))),
    )

    async def _fake_emit_project_event(*, user_id: object, project_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted.append((event_name, data))

    monkeypatch.setattr(sub_agent_routes.runtime_event_dispatcher, "emit_project_event", _fake_emit_project_event)

    response = asyncio.run(
        sub_agent_routes.delete_sub_agent(
            sub_agent_id=sub_agent_id,
            current_user=SimpleNamespace(id=user_id, settings=SimpleNamespace(active_preset_id=preset_id)),
            db=db,
        )
    )

    assert response == {"success": True}
    assert db.expired is False
    assert db.committed is True
    assert delete_calls == [(sub_agent_id, False)]
    assert applied == []
    assert emitted == []


def test_delete_sub_agent_cleans_threads_across_projects_and_emits_grouped_events(monkeypatch) -> None:
    user_id = uuid4()
    preset_id = uuid4()
    sub_agent_id = uuid4()
    project_a = uuid4()
    project_b = uuid4()
    thread_a = uuid4()
    thread_b = uuid4()
    thread_c = uuid4()
    thread_d = uuid4()
    db = FakeRouteDb()
    operations: list[tuple[str, object]] = []
    applied: list[tuple[object, list[object]]]= []
    emitted: list[tuple[str, dict[str, object]]] = []

    threads = [
        SimpleNamespace(id=thread_a, project_id=project_a, status="processing"),
        SimpleNamespace(id=thread_b, project_id=project_b, status="done"),
        SimpleNamespace(id=thread_c, project_id=project_b, status="waiting"),
        SimpleNamespace(id=thread_d, project_id=project_b, status="error"),
    ]
    project_a_deltas = [object()]
    project_b_deltas = [object(), object()]

    monkeypatch.setattr(sub_agent_routes, "get_active_preset_id", lambda *_args, **_kwargs: preset_id)
    monkeypatch.setattr(sub_agent_routes.sub_agent_service, "list_sub_agent_threads", lambda *_args, **_kwargs: threads)

    def _fake_delete_sub_agent(*_args, **kwargs) -> None:
        operations.append(("delete_sub_agent", kwargs["sub_agent_id"]))

    monkeypatch.setattr(sub_agent_routes.sub_agent_service, "delete_sub_agent", _fake_delete_sub_agent)
    monkeypatch.setattr(
        sub_agent_routes,
        "collect_thread_delete_deltas",
        lambda *_args, **_kwargs: {
            project_a: project_a_deltas,
            project_b: project_b_deltas,
        },
    )
    monkeypatch.setattr(
        sub_agent_routes,
        "delete_threads",
        lambda *_args, **_kwargs: {
            project_a: [str(thread_a)],
            project_b: [str(thread_b), str(thread_c), str(thread_d)],
        },
    )
    monkeypatch.setattr(
        sub_agent_routes,
        "apply_project_usage_deltas",
        lambda *_args, **_kwargs: applied.append((_kwargs["project_id"], list(_kwargs["deltas"]))),
    )

    async def _fake_cancel_run_for_delete(*, thread_id: object, user_id: object) -> None:
        operations.append(("cancel", thread_id))

    async def _fake_emit_project_event(*, user_id: object, project_id: object, event_name: str, data: dict[str, object]) -> None:
        emitted.append((event_name, data))

    monkeypatch.setattr(sub_agent_routes.run_pipeline, "cancel_run_for_delete", _fake_cancel_run_for_delete)
    monkeypatch.setattr(sub_agent_routes.runtime_event_dispatcher, "emit_project_event", _fake_emit_project_event)

    response = asyncio.run(
        sub_agent_routes.delete_sub_agent(
            sub_agent_id=sub_agent_id,
            current_user=SimpleNamespace(id=user_id, settings=SimpleNamespace(active_preset_id=preset_id)),
            db=db,
        )
    )

    assert response == {"success": True}
    assert db.expired is True
    assert db.committed is True
    assert operations == [
        ("cancel", thread_a),
        ("cancel", thread_c),
        ("cancel", thread_d),
        ("delete_sub_agent", sub_agent_id),
    ]
    assert applied == [
        (project_a, project_a_deltas),
        (project_b, project_b_deltas),
    ]
    assert emitted == [
        ("thread:delete", {"id": str(thread_a)}),
        ("thread:bulk_delete", {"ids": [str(thread_b), str(thread_c), str(thread_d)]}),
    ]

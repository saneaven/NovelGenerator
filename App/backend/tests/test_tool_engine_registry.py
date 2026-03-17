from __future__ import annotations

import asyncio
import sys
import types
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.orm import declarative_base

fake_database = types.ModuleType("App.backend.database")
fake_database.Base = declarative_base()
fake_database.SessionLocal = lambda: None
fake_database.get_db = lambda: None
sys.modules.setdefault("App.backend.database", fake_database)
sys.modules.setdefault("database", fake_database)

fake_settings_service = types.ModuleType("App.backend.services.settings_service")
fake_settings_service.settings_service = SimpleNamespace(_get_settings=lambda *_args, **_kwargs: SimpleNamespace())
sys.modules.setdefault("App.backend.services.settings_service", fake_settings_service)

fake_sidecar_client = types.ModuleType("App.backend.services.sidecar_client")
fake_sidecar_client.SidecarClient = object
fake_sidecar_client.sidecar_client = SimpleNamespace()
sys.modules.setdefault("App.backend.services.sidecar_client", fake_sidecar_client)

fake_storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")
fake_storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
fake_storage_usage_service.build_tool_call_delta = lambda *_args, **_kwargs: None
fake_storage_usage_service.snapshot_tool_call_row = lambda row: row
sys.modules.setdefault("App.backend.services.storage_usage_service", fake_storage_usage_service)

fake_run_pipeline_package = types.ModuleType("App.backend.services.run_pipeline")
fake_run_pipeline_package.__path__ = []  # type: ignore[attr-defined]
sys.modules.setdefault("App.backend.services.run_pipeline", fake_run_pipeline_package)

fake_run_pipeline_status_logic = types.ModuleType("App.backend.services.run_pipeline.status_logic")


def _derive_run_status(*, current_status: str | None, tool_call_statuses: list[str]) -> str | None:
    statuses = list(tool_call_statuses)
    if current_status == "paused":
        return "paused"
    if any(status == "pending" for status in statuses):
        return "waiting"
    if any(status in {"streaming", "validating", "processing", "working"} for status in statuses):
        return "processing"
    if any(status == "rejected" for status in statuses):
        return "paused"
    if statuses:
        return "done"
    return current_status


fake_run_pipeline_status_logic.derive_run_status = _derive_run_status
sys.modules.setdefault("App.backend.services.run_pipeline.status_logic", fake_run_pipeline_status_logic)

from App.backend.models.db_models import RunModel, Thread
from App.backend.models.db_models import RunMessageModel, RunToolCallModel
from App.backend.services.tool_engine import service as tool_service
from App.backend.services.tool_engine.contexts import ToolModuleContext
from App.backend.services.tool_engine.contracts import ToolCallModule, ToolOffer, ToolSpec
from App.backend.services.tool_engine.registry import ToolRegistry
from App.backend.services.tool_engine.schema_validation import validate_schema_required_enum_additional_properties
from App.backend.services.tool_engine.service import ToolEngineService


class _DummyModule(ToolCallModule):
    def __init__(self, prefix: str, spec_name: str = "read_story_entity") -> None:
        self.prefix = prefix
        self._spec_name = spec_name

    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("read",)

    def list_tools(self, _ctx: ToolModuleContext) -> list[ToolSpec]:
        return [_make_spec(self._spec_name)]

    async def validate(self, _tool_name, _args, _ctx):
        raise NotImplementedError

    async def execute(self, _tool_name, _args, _ctx):
        raise NotImplementedError


def _make_spec(name: str) -> ToolSpec:
    return ToolSpec(
        name=name,
        description=f"spec:{name}",
        parameters={
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "value": {"type": "string"},
            },
            "required": ["value"],
        },
        auto_approve_category="read",
    )


def test_tool_registry_register_duplicate_prefix_raises() -> None:
    registry = ToolRegistry()
    registry.register_module(_DummyModule("read_"))

    with pytest.raises(ValueError, match="Duplicate tool module prefix"):
        registry.register_module(_DummyModule("read_"))


def test_tool_registry_resolves_longest_prefix() -> None:
    registry = ToolRegistry()
    patch_module = _DummyModule("patch_", "patch_story_entity")
    patch_translation_module = _DummyModule("patch_translation_", "patch_translation_story_entity")

    registry.register_module(patch_module)
    registry.register_module(patch_translation_module)

    assert registry.resolve_module("patch_story_entity") is patch_module
    assert registry.resolve_module("patch_translation_story_entity") is patch_translation_module


def test_tool_registry_lists_auto_approve_categories_from_modules() -> None:
    registry = ToolRegistry()
    registry.register_module(_DummyModule("read_"))
    registry.register_module(_DummyModule("search_", "search_keyword"))

    assert registry.list_auto_approve_categories() == ["read"]


def test_validate_unknown_tool_prefix_fails() -> None:
    service = ToolEngineService(ToolRegistry())

    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="done",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=uuid4(),
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
    )
    offer = ToolOffer(
        specs_by_name={},
        provider_tools=[],
        auto_approve_category_by_name={},
    )

    result = asyncio.run(
        service.validate_tool_call(
            db=object(),
            thread=thread,
            run=run,
            tool_name="unknown_tool",
            args={},
            offer=offer,
            settings=SimpleNamespace(),
            user_id=thread.user_id,
            project_id=thread.project_id,
            language="English",
            preset_id=None,
            input_payload={},
            vector_storage_enabled=False,
        )
    )

    assert result.valid is False
    assert result.validator == "validate_tool_prefix"


def test_validate_schema_rejects_additional_properties() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "value": {"type": "string", "enum": ["a", "b"]},
        },
        "required": ["value"],
    }

    result = validate_schema_required_enum_additional_properties(
        {"value": "a", "extra": "x"},
        schema,
    )

    assert result.valid is False
    assert result.validator == "validate_schema_required_enum_additional_properties"


class _ParentCompletionQuery:
    def __init__(self, db: "_ParentCompletionDb", model: object) -> None:
        self._db = db
        self._model = model

    def filter(self, *_args: object, **_kwargs: object) -> "_ParentCompletionQuery":
        return self

    def order_by(self, *_args: object, **_kwargs: object) -> "_ParentCompletionQuery":
        return self

    def first(self) -> object:
        if self._model is RunToolCallModel:
            return self._db.parent_tool_call
        if self._model is RunMessageModel:
            return self._db.final_message
        if self._model is Thread:
            return self._db.parent_thread
        if self._model is RunModel:
            return self._db.parent_run
        raise AssertionError(f"Unexpected model query: {self._model!r}")

    def all(self) -> list[object]:
        if getattr(self._model, "class_", None) is RunToolCallModel:
            return [(self._db.parent_tool_call.status,)]
        raise AssertionError(f"Unexpected status query: {self._model!r}")


class _ParentCompletionDb:
    def __init__(
        self,
        *,
        parent_tool_call: RunToolCallModel,
        parent_thread: Thread,
        parent_run: RunModel,
        final_message: RunMessageModel | None,
    ) -> None:
        self.parent_tool_call = parent_tool_call
        self.parent_thread = parent_thread
        self.parent_run = parent_run
        self.final_message = final_message
        self.commits = 0

    def query(self, model: object) -> _ParentCompletionQuery:
        return _ParentCompletionQuery(self, model)

    def commit(self) -> None:
        self.commits += 1


def _make_parent_completion_state(*, child_status: str, child_error: str | None = None) -> tuple[_ParentCompletionDb, Thread, RunModel]:
    child_thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="subAgent",
        status=child_status,
    )
    child_run = RunModel(
        id=uuid4(),
        thread_id=child_thread.id,
        user_id=child_thread.user_id,
        project_id=child_thread.project_id,
        status=child_status,
        language="English",
        error=child_error,
    )
    child_run.thread = child_thread

    parent_thread = Thread(
        id=uuid4(),
        project_id=child_thread.project_id,
        user_id=child_thread.user_id,
        thread_type="agent",
        status="processing",
    )
    parent_run = RunModel(
        id=uuid4(),
        thread_id=parent_thread.id,
        user_id=parent_thread.user_id,
        project_id=parent_thread.project_id,
        status="processing",
        language="English",
    )
    parent_run.thread = parent_thread

    parent_tool_call = RunToolCallModel(
        id=uuid4(),
        thread_id=parent_thread.id,
        run_id=parent_run.id,
        assistant_message_id=uuid4(),
        call_seq=0,
        llm_call_id="call_1",
        tool_name="call_character_planner",
        arguments={"input": "hi"},
        status="working",
        result={"child_thread_id": str(child_thread.id)},
        child_thread_id=child_thread.id,
    )

    final_message = RunMessageModel(
        id=uuid4(),
        thread_id=child_thread.id,
        run_id=child_run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={
            "English": {
                "contentParts": [
                    {"type": "content", "text": "Child final output"},
                ],
            }
        },
    )
    db = _ParentCompletionDb(
        parent_tool_call=parent_tool_call,
        parent_thread=parent_thread,
        parent_run=parent_run,
        final_message=final_message,
    )
    return db, child_thread, child_run


@pytest.mark.parametrize("child_status", ["waiting", "processing", "paused", "error", "running"])
def test_propagate_child_terminal_state_to_parent_ignores_non_terminal_child_statuses(
    monkeypatch: pytest.MonkeyPatch,
    child_status: str,
) -> None:
    service = ToolEngineService(ToolRegistry())
    db, child_thread, child_run = _make_parent_completion_state(child_status=child_status)
    emitted: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(tool_service, "apply_project_usage_delta", lambda *_args, **_kwargs: None)

    async def _emit(*, event_name: str, data: dict[str, object], **_kwargs: object) -> None:
        emitted.append((event_name, data))

    asyncio.run(
        service.propagate_child_terminal_state_to_parent(
            db,  # type: ignore[arg-type]
            thread=child_thread,
            run=child_run,
            emit=_emit,
        )
    )

    assert db.parent_tool_call.status == "working"
    assert db.parent_run.status == "processing"
    assert db.parent_thread.status == "processing"
    assert db.commits == 0
    assert emitted == []


def test_propagate_child_terminal_state_to_parent_applies_done_child(monkeypatch: pytest.MonkeyPatch) -> None:
    service = ToolEngineService(ToolRegistry())
    db, child_thread, child_run = _make_parent_completion_state(child_status="done")
    emitted: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(tool_service, "apply_project_usage_delta", lambda *_args, **_kwargs: None)

    async def _emit(*, event_name: str, data: dict[str, object], **_kwargs: object) -> None:
        emitted.append((event_name, data))

    asyncio.run(
        service.propagate_child_terminal_state_to_parent(
            db,  # type: ignore[arg-type]
            thread=child_thread,
            run=child_run,
            emit=_emit,
        )
    )

    assert db.parent_tool_call.status == "applied"
    assert db.parent_tool_call.result == {"success": True, "message": "Child final output"}
    assert db.parent_tool_call.reason is None
    assert db.parent_run.status == "done"
    assert db.parent_thread.status == "done"
    assert [name for name, _payload in emitted] == ["tool_call:status", "run:status"]


def test_propagate_child_terminal_state_to_parent_fails_canceled_child(monkeypatch: pytest.MonkeyPatch) -> None:
    service = ToolEngineService(ToolRegistry())
    db, child_thread, child_run = _make_parent_completion_state(child_status="canceled")
    emitted: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(tool_service, "apply_project_usage_delta", lambda *_args, **_kwargs: None)

    async def _emit(*, event_name: str, data: dict[str, object], **_kwargs: object) -> None:
        emitted.append((event_name, data))

    asyncio.run(
        service.propagate_child_terminal_state_to_parent(
            db,  # type: ignore[arg-type]
            thread=child_thread,
            run=child_run,
            emit=_emit,
        )
    )

    assert db.parent_tool_call.status == "failed"
    assert db.parent_tool_call.reason == "Sub-agent canceled"
    assert db.parent_tool_call.result == {"success": False, "message": "Sub-agent canceled"}
    assert db.parent_run.status == "done"
    assert db.parent_thread.status == "done"
    assert [name for name, _payload in emitted] == ["tool_call:status", "run:status"]

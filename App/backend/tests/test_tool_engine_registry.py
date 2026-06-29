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

fake_storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")
fake_storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
fake_storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
fake_storage_usage_service.build_usage_delta_for_amount = lambda *_args, **_kwargs: None
fake_storage_usage_service.measure_tool_call_row = lambda _row: 0
sys.modules.setdefault("App.backend.services.storage_usage_service", fake_storage_usage_service)

fake_run_pipeline_package = types.ModuleType("App.backend.services.run_pipeline")
fake_run_pipeline_package.__path__ = []  # type: ignore[attr-defined]
sys.modules.setdefault("App.backend.services.run_pipeline", fake_run_pipeline_package)

fake_run_pipeline_status_logic = types.ModuleType("App.backend.services.run_pipeline.status_logic")


def _derive_run_status(*, current_status: str | None, tool_call_statuses: list[str]) -> str | None:
    statuses = list(tool_call_statuses)
    if current_status == "paused":
        return "paused"
    if not statuses:
        return "done"
    if any(status == "pending" for status in statuses):
        return "waiting"
    if any(status in {"streaming", "validating", "processing", "working"} for status in statuses):
        return "processing"
    if any(status == "rejected" for status in statuses):
        return "paused"
    if all(status in {"applied", "failed"} for status in statuses):
        return "ready"
    raise ValueError(f"Unknown tool call status combination: {statuses!r}")


fake_run_pipeline_status_logic.derive_run_status = _derive_run_status
sys.modules.setdefault("App.backend.services.run_pipeline.status_logic", fake_run_pipeline_status_logic)

fake_pil = types.ModuleType("PIL")
fake_pil.Image = object
fake_pil.ImageOps = object
sys.modules.setdefault("PIL", fake_pil)

from App.backend.models.db_models import RunModel, Thread
from App.backend.models.db_models import RunMessageModel, RunToolCallModel
from App.backend.services.tool_engine import service as tool_service
from App.backend.services.tool_engine.contexts import ToolGroupExecutionContext, ToolModuleContext
from App.backend.services.tool_engine.contracts import (
    PersistedToolMeta,
    ToolBinding,
    ToolBindingMeta,
    ToolDecisionGroup,
    ToolDecisionItem,
    ToolExecutionOutcome,
    ToolExecutionResult,
    ToolFeatureModule,
    ToolOffer,
    ToolSpec,
)
from App.backend.services.tool_engine.modules.feature_common import apply_object_batch_group
from App.backend.services.tool_engine.registry import ToolRegistry
from App.backend.services.tool_engine.schema_validation import validate_schema_required_enum_additional_properties
from App.backend.services.tool_engine.service import ToolEngineService
from App.backend.services.tool_engine.result_utils import valid_result


class _DummyModule(ToolFeatureModule):
    def __init__(self, feature_key: str, spec_name: str = "read_story_entity") -> None:
        self.feature_key = feature_key
        self._spec_name = spec_name

    def list_bindings(self, _ctx: ToolModuleContext) -> list[ToolBinding]:
        spec = _make_spec(self._spec_name)

        async def _validate(_args, _ctx):
            return valid_result()

        async def _execute(_args, _ctx):
            raise NotImplementedError

        return [
            ToolBinding(
                spec=spec,
                meta=ToolBindingMeta(
                    feature_key=self.feature_key,
                    category="read",
                    op="read",
                    target_kind="story_entity",
                ),
                validate=_validate,
                execute=_execute,
                build_persisted_meta=lambda _ctx, _args: None,  # type: ignore[arg-type]
            )
        ]


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
    )


def test_tool_registry_register_duplicate_feature_key_raises() -> None:
    registry = ToolRegistry()
    registry.register_module(_DummyModule("story_entity"))

    with pytest.raises(ValueError, match="Duplicate tool feature module"):
        registry.register_module(_DummyModule("story_entity"))


def test_tool_registry_build_offer_rejects_duplicate_tool_name() -> None:
    registry = ToolRegistry()
    registry.register_module(_DummyModule("story_entity", "read_story_entity"))
    registry.register_module(_DummyModule("outline", "read_story_entity"))

    with pytest.raises(ValueError, match="Duplicate tool registration in offer"):
        registry.build_offer(SimpleNamespace())

def test_validate_unknown_tool_name_fails() -> None:
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
    assert result.validator == "validate_tool_is_in_offer"


def test_validate_translation_tool_uses_target_language_for_context() -> None:
    service = ToolEngineService(ToolRegistry())
    captured: dict[str, str] = {}

    async def _validate(_args, ctx):
        captured["language"] = ctx.language
        return valid_result()

    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="done",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
    )
    spec = ToolSpec(
        name="translate_test",
        description="Translate test.",
        parameters={
            "type": "object",
            "additionalProperties": False,
            "properties": {"targetLanguage": {"type": "string", "enum": ["English", "Korean"]}},
            "required": ["targetLanguage"],
        },
    )
    binding = ToolBinding(
        spec=spec,
        meta=ToolBindingMeta(feature_key="outline", category="translate", op="translate", target_kind="outline"),
        validate=_validate,
        execute=lambda _args, _ctx: None,
        build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
            feature_key="outline",
            category="translate",
            op="translate",
            target_kind="outline",
            target_id=None,
            merge_key=None,
        ),
    )
    offer = ToolOffer(
        specs_by_name={"translate_test": spec},
        bindings_by_name={"translate_test": binding},
    )

    result = asyncio.run(
        service.validate_tool_call(
            db=object(),
            thread=thread,
            run=run,
            settings=SimpleNamespace(main_language="English", sub_languages=["Korean"]),
            tool_name="translate_test",
            args={"targetLanguage": "Korean"},
            offer=offer,
            user_id=thread.user_id,
            project_id=thread.project_id,
            language=run.language,
            preset_id=None,
            input_payload={},
            vector_storage_enabled=False,
        )
    )

    assert result.valid is True
    assert captured["language"] == "Korean"


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


def test_validate_schema_accepts_nullable_null_values() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string"},
            "endDate": {
                "type": "object",
                "nullable": True,
                "properties": {"year": {"type": "integer"}},
                "required": ["year"],
            },
        },
        "required": ["name"],
    }

    result = validate_schema_required_enum_additional_properties(
        {"name": "Coronation", "endDate": None},
        schema,
    )

    assert result.valid is True


def test_validate_schema_checks_union_type_values() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "folderId": {"type": ["string", "null"]},
        },
        "required": [],
    }

    assert validate_schema_required_enum_additional_properties({"folderId": None}, schema).valid is True
    assert validate_schema_required_enum_additional_properties({"folderId": "folder-1"}, schema).valid is True

    result = validate_schema_required_enum_additional_properties({"folderId": 123}, schema)

    assert result.valid is False
    assert result.reason == "Invalid type for folderId: expected string|null"


def test_feature_apply_group_rejects_non_outcome_result() -> None:
    class _NonOutcomeModule(ToolFeatureModule):
        feature_key = "story_entity"

        def list_bindings(self, _ctx: ToolModuleContext) -> list[ToolBinding]:
            async def _validate(_args, _ctx):
                return valid_result()

            async def _execute(_args, _ctx):
                return {"success": True}

            return [
                ToolBinding(
                    spec=_make_spec("read_story_entity"),
                    meta=ToolBindingMeta(
                        feature_key="story_entity",
                        category="read",
                        op="read",
                        target_kind="story_entity",
                    ),
                    validate=_validate,
                    execute=_execute,
                    build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
                        feature_key="story_entity",
                        category="read",
                        op="read",
                        target_kind="story_entity",
                        target_id=None,
                        merge_key=None,
                    ),
                )
            ]

    module = _NonOutcomeModule()
    binding = module.list_bindings(SimpleNamespace())[0]
    item = ToolDecisionItem(
        tool_call_id=uuid4(),
        binding=binding,
        args={"value": "x"},
        meta=PersistedToolMeta(
            feature_key="story_entity",
            category="read",
            op="read",
            target_kind="story_entity",
            target_id=None,
            merge_key=None,
        ),
        call_seq=0,
    )
    group = ToolDecisionGroup(feature_key="story_entity", merge_key="story_entity:x", items=(item,))
    ctx = ToolGroupExecutionContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(),
        run=SimpleNamespace(),
        settings=SimpleNamespace(),
        user_id=uuid4(),
        project_id=uuid4(),
        language="English",
    )

    with pytest.raises(ValueError, match="Invalid execution outcome"):
        asyncio.run(module.apply_group(group=group, ctx=ctx))


class _GroupResultQuery:
    def __init__(self, db: "_GroupResultDb") -> None:
        self._db = db

    def filter(self, *_args: object, **_kwargs: object) -> "_GroupResultQuery":
        return self

    def first(self) -> object:
        if not self._db.rows_to_return:
            raise AssertionError("No queued group result row")
        return self._db.rows_to_return.pop(0)


class _GroupResultDb:
    def __init__(self, rows: list[RunToolCallModel]) -> None:
        self.rows_to_return = list(rows)
        self.rollbacks = 0
        self.commits = 0
        self.refreshes: list[RunToolCallModel] = []

    def query(self, model: object) -> _GroupResultQuery:
        assert model is RunToolCallModel
        return _GroupResultQuery(self)

    def rollback(self) -> None:
        self.rollbacks += 1

    def commit(self) -> None:
        self.commits += 1

    def refresh(self, row: RunToolCallModel) -> None:
        self.refreshes.append(row)


def test_execute_group_collects_success_and_failure_results(monkeypatch: pytest.MonkeyPatch) -> None:
    failed_reason = (
        '<patch_failure code="PATCH_NOT_FOUND" kind="target_mismatch">'
        "<mismatches><mismatch>"
        "<expected_block>missing</expected_block>"
        "<actual_block>current</actual_block>"
        "</mismatch></mismatches>"
        "</patch_failure>"
    )
    first_id = uuid4()
    failed_id = uuid4()
    third_id = uuid4()

    class _CollectingGroupedModule(ToolFeatureModule):
        feature_key = "story_entity"

        def list_bindings(self, _ctx: ToolModuleContext) -> list[ToolBinding]:
            return []

        async def apply_group(self, *, group: ToolDecisionGroup, ctx) -> list[ToolExecutionResult]:
            del group, ctx
            return [
                ToolExecutionResult(
                    tool_call_id=first_id,
                    outcome=ToolExecutionOutcome(
                        lifecycle="applied",
                        result={"success": True, "message": "first applied"},
                    ),
                ),
                ToolExecutionResult(
                    tool_call_id=failed_id,
                    outcome=ToolExecutionOutcome(
                        lifecycle="failed",
                        reason=failed_reason,
                    ),
                ),
                ToolExecutionResult(
                    tool_call_id=third_id,
                    outcome=ToolExecutionOutcome(
                        lifecycle="applied",
                        result={"success": True, "message": "third applied"},
                    ),
                ),
            ]

    registry = ToolRegistry()
    registry.register_module(_CollectingGroupedModule())
    service = ToolEngineService(registry)
    monkeypatch.setattr(
        service,
        "_build_group_execution_context",
        lambda **kwargs: ToolGroupExecutionContext(**kwargs),  # type: ignore[arg-type]
    )

    binding = ToolBinding(
        spec=_make_spec("patch_story_entity"),
        meta=ToolBindingMeta(
            feature_key="story_entity",
            category="write",
            op="patch",
            target_kind="story_entity",
        ),
        validate=lambda _args, _ctx: valid_result(),
        execute=lambda _args, _ctx: None,
        build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
            feature_key="story_entity",
            category="write",
            op="patch",
            target_kind="story_entity",
            target_id=str(uuid4()),
            merge_key="story_entity:test",
        ),
    )

    items = tuple(
        ToolDecisionItem(
            tool_call_id=tool_call_id,
            binding=binding,
            args={"value": "x"},
            meta=PersistedToolMeta(
                feature_key="story_entity",
                category="write",
                op="patch",
                target_kind="story_entity",
                target_id=str(uuid4()),
                merge_key="story_entity:test",
            ),
            call_seq=index,
        )
        for index, tool_call_id in enumerate((first_id, failed_id, third_id))
    )
    rows = [
        RunToolCallModel(id=first_id, status="processing", tool_name="patch_story_entity", arguments={}),
        RunToolCallModel(id=failed_id, status="processing", tool_name="patch_story_entity", arguments={}),
        RunToolCallModel(id=third_id, status="processing", tool_name="patch_story_entity", arguments={}),
    ]
    db = _GroupResultDb(rows)
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="processing")
    run = RunModel(id=uuid4(), thread_id=thread.id, user_id=thread.user_id, project_id=thread.project_id, status="processing")

    results = asyncio.run(
        service._execute_group(  # pylint: disable=protected-access
            db,  # type: ignore[arg-type]
            thread=thread,
            run=run,
            settings=SimpleNamespace(),
            rows_by_id={row.id: row for row in rows},
            group=ToolDecisionGroup(feature_key="story_entity", merge_key="story_entity:test", items=items),
            user_id=thread.user_id,
            project_id=thread.project_id,
            language="English",
            preset_id=uuid4(),
            input_payload={},
            vector_storage_enabled=False,
        )
    )

    assert [result.status for result in results] == ["applied", "failed", "applied"]
    assert rows[0].status == "applied"
    assert rows[0].reason is None
    assert rows[0].result == {"success": True, "message": "first applied"}
    assert rows[1].status == "failed"
    assert rows[1].reason == failed_reason
    assert rows[1].result == {"success": False, "message": failed_reason, "error": failed_reason}
    assert rows[2].status == "applied"
    assert rows[2].reason is None
    assert rows[2].result == {"success": True, "message": "third applied"}
    assert db.rollbacks == 0
    assert db.commits == 1
    assert db.refreshes == rows


def test_apply_object_batch_group_collects_item_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    first_id = uuid4()
    failed_id = uuid4()
    third_id = uuid4()
    object_id = uuid4()
    failed_reason = "PATCH_NOT_FOUND"

    class _FakeObjectPatchBatch:
        instances: list["_FakeObjectPatchBatch"] = []

        def __init__(self) -> None:
            self.applied_call_ids: list[str] = []
            self.success_keys: set[str] = set()
            _FakeObjectPatchBatch.instances.append(self)

        @staticmethod
        def make_key(object_type: str, object_id, language: str) -> str:
            return f"{object_type}:{object_id}:{language}"

        def apply_patch(self, **kwargs):
            call_id = str(kwargs["call_id"])
            self.applied_call_ids.append(call_id)
            if call_id == str(failed_id):
                return {"success": False, "reason": failed_reason}
            self.success_keys.add(self.make_key(kwargs["object_type"], kwargs["object_id"], kwargs["language"]))
            return {"success": True}

        def apply_replace(self, **_kwargs):
            raise AssertionError("replace should not be used")

        def flush_all(self, **_kwargs):
            return (
                {key: SimpleNamespace(success=True, reason=None) for key in self.success_keys},
                {},
            )

    fake_patch_module = types.ModuleType("App.backend.services.object_patch_batch")
    fake_patch_module.ObjectPatchBatch = _FakeObjectPatchBatch
    monkeypatch.setitem(sys.modules, "App.backend.services.object_patch_batch", fake_patch_module)

    fake_object_service = types.ModuleType("App.backend.services.object_service")
    fake_object_service.object_service = SimpleNamespace()
    monkeypatch.setitem(sys.modules, "App.backend.services.object_service", fake_object_service)

    binding = ToolBinding(
        spec=_make_spec("patch_story_entity"),
        meta=ToolBindingMeta(
            feature_key="story_entity",
            category="write",
            op="patch",
            target_kind="story_entity",
        ),
        validate=lambda _args, _ctx: valid_result(),
        execute=lambda _args, _ctx: None,
        build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
            feature_key="story_entity",
            category="write",
            op="patch",
            target_kind="story_entity",
            target_id=str(object_id),
            merge_key="story_entity:test",
        ),
    )
    items = tuple(
        ToolDecisionItem(
            tool_call_id=tool_call_id,
            binding=binding,
            args={"field": "content", "old": "old", "new": "new"},
            meta=PersistedToolMeta(
                feature_key="story_entity",
                category="write",
                op="patch",
                target_kind="story_entity",
                target_id=str(object_id),
                merge_key="story_entity:test",
            ),
            call_seq=index,
        )
        for index, tool_call_id in enumerate((first_id, failed_id, third_id))
    )

    results = asyncio.run(
        apply_object_batch_group(
            group=ToolDecisionGroup(feature_key="story_entity", merge_key="story_entity:test", items=items),
            ctx=ToolGroupExecutionContext(
                db=SimpleNamespace(),
                thread=SimpleNamespace(),
                run=SimpleNamespace(),
                settings=SimpleNamespace(),
                user_id=uuid4(),
                project_id=uuid4(),
                language="English",
            ),
            object_type_for_item=lambda _item: "story_entity",
            replace_fields_for_item=lambda _item: {},
            metadata_for_item=lambda _item: None,
            result_for_item=lambda item: {"success": True, "message": f"applied:{item.tool_call_id}"},
        )
    )

    assert [result.outcome.lifecycle for result in results] == ["applied", "failed", "applied"]
    assert results[1].outcome.reason == failed_reason
    assert _FakeObjectPatchBatch.instances[0].applied_call_ids == [
        str(first_id),
        str(failed_id),
        str(third_id),
    ]


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


@pytest.mark.parametrize("child_status", ["waiting", "processing", "ready", "paused", "error", "running"])
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
    assert db.parent_run.status == "ready"
    assert db.parent_thread.status == "ready"
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
    assert db.parent_run.status == "ready"
    assert db.parent_thread.status == "ready"
    assert [name for name, _payload in emitted] == ["tool_call:status", "run:status"]

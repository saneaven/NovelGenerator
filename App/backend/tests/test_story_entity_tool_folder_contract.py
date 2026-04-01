from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import types
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


fake_database = types.ModuleType("App.backend.database")
fake_database.Base = declarative_base()
fake_database.SessionLocal = lambda: None
fake_database.get_db = lambda: None
sys.modules.setdefault("App.backend.database", fake_database)
sys.modules.setdefault("database", fake_database)

fake_pil = types.ModuleType("PIL")
fake_pil.Image = object
fake_pil.ImageOps = object
sys.modules.setdefault("PIL", fake_pil)

fake_mistune = types.ModuleType("mistune")
fake_mistune.create_markdown = lambda *_args, **_kwargs: None
sys.modules.setdefault("mistune", fake_mistune)

fake_markdown_it_pyrs = types.ModuleType("markdown_it_pyrs")


class _FakeMarkdownIt:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def enable_many(self, *_args, **_kwargs):
        return self


fake_markdown_it_pyrs.MarkdownIt = _FakeMarkdownIt
sys.modules.setdefault("markdown_it_pyrs", fake_markdown_it_pyrs)

fake_object_service_module = types.ModuleType("App.backend.services.object_service")
fake_object_service_module.object_service = SimpleNamespace(
    create_object=lambda *_args, **_kwargs: {"id": "entity-1"},
    update_object=lambda *_args, **_kwargs: None,
    get_object=lambda *_args, **_kwargs: None,
    list_objects=lambda *_args, **_kwargs: [],
    delete_object=lambda *_args, **_kwargs: None,
)
sys.modules.setdefault("App.backend.services.object_service", fake_object_service_module)

fake_manuscript_access = types.ModuleType("App.backend.services.tool_engine.modules.manuscript_access")


async def _fake_patch_manuscript(*_args, **_kwargs):
    return None


async def _fake_replace_manuscript(*_args, **_kwargs):
    return None


async def _fake_validate_patch_args(*_args, **_kwargs):
    return None


async def _fake_read_manuscript_markdown(*_args, **_kwargs):
    return None, ""


fake_manuscript_access.patch_manuscript = _fake_patch_manuscript
fake_manuscript_access.replace_manuscript = _fake_replace_manuscript
fake_manuscript_access.validate_patch_args = _fake_validate_patch_args
fake_manuscript_access.read_manuscript_markdown = _fake_read_manuscript_markdown
fake_manuscript_access.ensure_manuscript_exists = lambda *_args, **_kwargs: None
sys.modules.setdefault("App.backend.services.tool_engine.modules.manuscript_access", fake_manuscript_access)

from App.backend.services.tool_engine.contexts import ToolExecutionContext, ToolGroupExecutionContext, ToolModuleContext, ToolValidationContext
from App.backend.services.tool_engine.contracts import ToolDecisionGroup, ToolDecisionItem, ToolExecutionOutcome, ToolExecutionResult
from App.backend.services.tool_engine.modules import object_access
from App.backend.services.tool_engine.modules import outline_module, story_entity_module
from App.backend.services.tool_engine.modules.outline_module import OutlineFeatureModule
from App.backend.services.tool_engine.modules.story_entity_module import StoryEntityFeatureModule


def _module_context() -> ToolModuleContext:
    return ToolModuleContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(language="English"),
        settings=SimpleNamespace(),
        preset_id=uuid4(),
        user_id=uuid4(),
        project_id=uuid4(),
        input_payload={},
        vector_storage_enabled=False,
        invocation_mode="agentMode",
    )


def _execution_context() -> ToolExecutionContext:
    return ToolExecutionContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(language="English"),
        settings=SimpleNamespace(),
        tool_call_row=SimpleNamespace(id=uuid4(), call_seq=0),
        user_id=uuid4(),
        project_id=uuid4(),
        language="English",
    )


def _validation_context() -> ToolValidationContext:
    return ToolValidationContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(language="English"),
        settings=SimpleNamespace(),
        user_id=uuid4(),
        project_id=uuid4(),
        language="English",
    )


def _group_context() -> ToolGroupExecutionContext:
    return ToolGroupExecutionContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(language="English"),
        settings=SimpleNamespace(),
        user_id=uuid4(),
        project_id=uuid4(),
        language="English",
    )


def _binding_by_name(module, ctx: ToolModuleContext, name: str):
    for binding in module.list_bindings(ctx):
        if binding.spec.name == name:
            return binding
    raise AssertionError(f"Binding not found: {name}")


def _capture_object_group(*, monkeypatch, module_under_test, feature, binding, args: dict[str, object]) -> dict[str, object]:
    captured: dict[str, object] = {}
    module_ctx = _module_context()
    group_ctx = _group_context()

    async def _fake_apply_object_batch_group(
        *,
        group,
        ctx,
        object_type_for_item,
        replace_fields_for_item,
        metadata_for_item,
        result_for_item,
    ):
        _ = ctx
        item = group.items[0]
        captured["object_type"] = object_type_for_item(item)
        captured["replace_fields"] = replace_fields_for_item(item)
        captured["metadata"] = metadata_for_item(item)
        captured["result"] = result_for_item(item)
        return [
            ToolExecutionResult(
                tool_call_id=item.tool_call_id,
                outcome=ToolExecutionOutcome(lifecycle="applied", result={"success": True}),
            )
        ]

    monkeypatch.setattr(module_under_test, "apply_object_batch_group", _fake_apply_object_batch_group)

    item = ToolDecisionItem(
        tool_call_id=uuid4(),
        binding=binding,
        args=args,
        meta=binding.build_persisted_meta(module_ctx, args),
        call_seq=0,
    )
    group = ToolDecisionGroup(
        feature_key=feature.feature_key,
        merge_key=item.meta.merge_key or "fallback",
        items=(item,),
    )
    asyncio.run(feature.apply_group(group=group, ctx=group_ctx))
    return captured


def test_story_entity_tool_schemas_include_optional_folder_id() -> None:
    ctx = _module_context()
    module = StoryEntityFeatureModule()
    specs = {
        binding.spec.name: binding.spec
        for binding in module.list_bindings(ctx)
        if binding.spec.name in {"create_story_entity", "replace_story_entity", "patch_story_entity"}
    }

    assert specs["create_story_entity"].parameters["properties"]["folderId"]["type"] == ["string", "null"]
    assert specs["replace_story_entity"].parameters["properties"]["folderId"]["type"] == ["string", "null"]
    assert specs["patch_story_entity"].parameters["properties"]["folderId"]["type"] == ["string", "null"]


def test_story_entity_folder_tool_schemas_are_registered(monkeypatch) -> None:
    ctx = _module_context()
    monkeypatch.setattr(story_entity_module, "is_translation_journey", lambda _ctx: True)
    module = StoryEntityFeatureModule()
    specs = {binding.spec.name: binding.spec for binding in module.list_bindings(ctx)}

    assert specs["create_story_entity_folder"].parameters["required"] == ["name"]
    assert specs["create_story_entity_folder"].parameters["properties"]["parentId"]["type"] == ["string", "null"]
    assert specs["read_story_entity_folder"].parameters["required"] == ["id"]
    assert specs["replace_story_entity_folder"].parameters["properties"]["position"]["type"] == "integer"
    assert specs["patch_story_entity_folder"].parameters["properties"]["field"]["enum"] == ["name", "description"]
    assert specs["delete_story_entity_folder"].parameters["required"] == ["id"]
    assert specs["translate_story_entity_folder"].parameters["required"] == ["id"]
    assert specs["patch_translation_story_entity_folder"].parameters["properties"]["field"]["enum"] == ["name", "description"]


def test_runtime_rich_text_kwargs_only_marks_rich_objects() -> None:
    assert object_access.runtime_rich_text_kwargs("story_entity") == {"rich_text_format": "markdown"}
    assert object_access.runtime_rich_text_kwargs("outline") == {"rich_text_format": "markdown"}
    assert object_access.runtime_rich_text_kwargs("timeline_track") == {"rich_text_format": "markdown"}
    assert object_access.runtime_rich_text_kwargs("basic_info") == {}
    assert object_access.runtime_rich_text_kwargs("story_entity_folder") == {}


def test_create_story_entity_passes_folder_id_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_create_object(*_args, **kwargs):
        captured.update(kwargs)
        return {"id": "entity-1"}

    monkeypatch.setattr(story_entity_module.object_service, "create_object", _fake_create_object)
    binding = _binding_by_name(StoryEntityFeatureModule(), _module_context(), "create_story_entity")

    outcome = asyncio.run(
        binding.execute(
            {
                "kind": "character",
                "name": "Ari",
                "description": "Broker",
                "content": "Detailed content",
                "folderId": "folder-main-cast",
            },
            _execution_context(),
        )
    )

    assert captured["metadata"] == {"folder_id": "folder-main-cast"}
    assert captured["rich_text_format"] == "markdown"
    assert outcome.result["data"]["kind"] == "character"


def test_create_story_entity_folder_passes_parent_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_create_object(*_args, **kwargs):
        captured.update(kwargs)
        return {"id": "folder-1"}

    monkeypatch.setattr(story_entity_module.object_service, "create_object", _fake_create_object)
    binding = _binding_by_name(StoryEntityFeatureModule(), _module_context(), "create_story_entity_folder")

    outcome = asyncio.run(
        binding.execute(
            {
                "name": "Main Cast",
                "description": "Primary characters",
                "parentId": "folder-root",
            },
            _execution_context(),
        )
    )

    assert captured["metadata"] == {"parent_id": "folder-root"}
    assert "rich_text_format" not in captured
    assert outcome.result["objectType"] == "story_entity_folder"


def test_create_outline_uses_markdown_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_create_object(*_args, **kwargs):
        captured.update(kwargs)
        return {"id": "outline-1", "metadata": {}}

    monkeypatch.setattr(outline_module.object_service, "create_object", _fake_create_object)
    binding = _binding_by_name(OutlineFeatureModule(), _module_context(), "create_outline")

    outcome = asyncio.run(
        binding.execute(
            {
                "kind": "chapter",
                "name": "Chapter 1",
                "description": "Opening",
                "content": "## Beat\n\nSomething happens.",
                "parentId": str(uuid4()),
                "position": 0,
            },
            _execution_context(),
        )
    )

    assert captured["rich_text_format"] == "markdown"
    assert outcome.result["objectType"] == "outline"


def test_replace_story_entity_group_passes_folder_id_metadata(monkeypatch) -> None:
    feature = StoryEntityFeatureModule()
    binding = _binding_by_name(feature, _module_context(), "replace_story_entity")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=story_entity_module,
        feature=feature,
        binding=binding,
        args={
            "id": str(uuid4()),
            "kind": "character",
            "name": "Eira",
            "folderId": None,
        },
    )

    assert captured["object_type"] == "story_entity"
    assert captured["metadata"] == {"folder_id": None}
    assert captured["replace_fields"] == {"name": "Eira"}


def test_replace_story_entity_folder_group_passes_structural_metadata(monkeypatch) -> None:
    feature = StoryEntityFeatureModule()
    binding = _binding_by_name(feature, _module_context(), "replace_story_entity_folder")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=story_entity_module,
        feature=feature,
        binding=binding,
        args={
            "id": str(uuid4()),
            "parentId": "folder-archive",
            "position": 2,
        },
    )

    assert captured["object_type"] == "story_entity_folder"
    assert captured["metadata"] == {"parent_id": "folder-archive", "display_order": 2}
    assert captured["replace_fields"] == {}


def test_translate_story_entity_folder_group_uses_content_fields_only(monkeypatch) -> None:
    monkeypatch.setattr(story_entity_module, "is_translation_journey", lambda _ctx: True)
    feature = StoryEntityFeatureModule()
    binding = _binding_by_name(feature, _module_context(), "translate_story_entity_folder")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=story_entity_module,
        feature=feature,
        binding=binding,
        args={
            "id": str(uuid4()),
            "name": "Main Cast KR",
        },
    )

    assert captured["object_type"] == "story_entity_folder"
    assert captured["metadata"] is None
    assert captured["replace_fields"] == {"name": "Main Cast KR"}


def test_validate_patch_outline_reads_markdown_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_read_object(*_args, **_kwargs):
        captured["called"] = True
        return {
            "kind": "chapter",
            "data": {
                "English": {
                    "name": "Chapter 1",
                    "description": "Outline desc",
                    "content": "**Timeline**: Months 44-46 - daily life as the community rebuilds.",
                }
            },
        }

    monkeypatch.setattr(outline_module, "read_runtime_object", _fake_read_object)
    binding = _binding_by_name(OutlineFeatureModule(), _module_context(), "patch_outline")

    result = asyncio.run(
        binding.validate(
            {
                "id": str(uuid4()),
                "field": "content",
                "old": "**Timeline**: Months 44-46 - daily life as the community rebuilds.",
                "new": "**Timeline**: Months 44-46 - daily routines as the community rebuilds.",
            },
            _validation_context(),
        )
    )

    assert result.valid is True
    assert captured["called"] is True


def test_replace_outline_group_uses_markdown_content_field(monkeypatch) -> None:
    feature = OutlineFeatureModule()
    binding = _binding_by_name(feature, _module_context(), "replace_outline")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=outline_module,
        feature=feature,
        binding=binding,
        args={
            "id": str(uuid4()),
            "content": "## New outline content",
        },
    )

    assert captured["object_type"] == "outline"
    assert captured["replace_fields"] == {"content": "## New outline content"}


def test_translate_outline_group_uses_markdown_content_field(monkeypatch) -> None:
    monkeypatch.setattr(outline_module, "is_translation_journey", lambda _ctx: True)
    feature = OutlineFeatureModule()
    binding = _binding_by_name(feature, _module_context(), "translate_outline")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=outline_module,
        feature=feature,
        binding=binding,
        args={
            "id": str(uuid4()),
            "name": "Chapter 1",
            "description": "Translated desc",
            "content": "Translated markdown",
        },
    )

    assert captured["replace_fields"] == {
        "name": "Chapter 1",
        "description": "Translated desc",
        "content": "Translated markdown",
    }


def test_thread_route_runtime_payload_includes_parent_metadata() -> None:
    source = (ROOT / "App" / "backend" / "routes" / "thread_routes.py").read_text(encoding="utf-8")

    assert 'runtime_fields["parent_id"]' in source
    assert 'runtime_fields["journey_kind"]' in source
    assert 'runtime_fields["display_label"]' in source

from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import types
from types import SimpleNamespace
from uuid import UUID, uuid4

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
fake_pil.__version__ = "0.0"
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
from App.backend.services.tool_engine.contracts import (
    ToolDecisionGroup,
    ToolDecisionItem,
    ToolExecutionOutcome,
    ToolExecutionResult,
)
from App.backend.services.tool_engine.language import tool_language_for_args
from App.backend.services.tool_engine.modules import manuscript_module, object_access, project_data_module
from App.backend.services.tool_engine.modules import outline_module, story_entity_module, timeline_module
from App.backend.services.tool_engine.modules.manuscript_module import ManuscriptFeatureModule
from App.backend.services.tool_engine.modules.outline_module import OutlineFeatureModule
from App.backend.services.tool_engine.modules.project_data_module import ProjectDataFeatureModule
from App.backend.services.tool_engine.modules.story_entity_module import StoryEntityFeatureModule
from App.backend.services.tool_engine.modules.timeline_module import TimelineFeatureModule
from App.backend.services.tool_engine.registry import ToolRegistry
from App.backend.services.tool_engine.schema_validation import validate_schema_required_enum_additional_properties


def _module_context(*, invocation_mode: str = "agentMode") -> ToolModuleContext:
    return ToolModuleContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(language="English"),
        settings=SimpleNamespace(main_language="English", sub_languages=["Korean", "Japanese"]),
        preset_id=uuid4(),
        user_id=uuid4(),
        project_id=uuid4(),
        input_payload={},
        vector_storage_enabled=False,
        invocation_mode=invocation_mode,
    )


def _execution_context() -> ToolExecutionContext:
    return ToolExecutionContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(language="English"),
        settings=SimpleNamespace(main_language="English", sub_languages=["Korean", "Japanese"]),
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
        settings=SimpleNamespace(main_language="English", sub_languages=["Korean", "Japanese"]),
        user_id=uuid4(),
        project_id=uuid4(),
        language="English",
    )


def _group_context() -> ToolGroupExecutionContext:
    return ToolGroupExecutionContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(language="English"),
        settings=SimpleNamespace(main_language="English", sub_languages=["Korean", "Japanese"]),
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
        captured["args"] = item.args
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
    assert specs["create_story_entity"].parameters["required"] == ["kind", "name", "description", "content"]
    assert specs["replace_story_entity"].parameters["properties"]["folderId"]["type"] == ["string", "null"]
    assert specs["patch_story_entity"].parameters["properties"]["folderId"]["type"] == ["string", "null"]


def test_story_entity_folder_tool_schemas_are_registered(monkeypatch) -> None:
    ctx = _module_context()
    monkeypatch.setattr(story_entity_module, "is_translation_journey", lambda _ctx: True)
    module = StoryEntityFeatureModule()
    specs = {binding.spec.name: binding.spec for binding in module.list_bindings(ctx)}

    assert specs["create_story_entity_folder"].parameters["required"] == ["name", "description"]
    assert specs["create_story_entity_folder"].parameters["properties"]["parentId"]["type"] == ["string", "null"]
    assert specs["read_story_entity_folder"].parameters["required"] == ["id"]
    assert specs["replace_story_entity_folder"].parameters["properties"]["position"]["type"] == "integer"
    assert specs["patch_story_entity_folder"].parameters["properties"]["field"]["enum"] == ["name", "description"]
    assert specs["delete_story_entity_folder"].parameters["required"] == ["id"]
    assert specs["translate_story_entity_folder"].parameters["required"] == ["targetLanguage", "id"]
    assert specs["translate_story_entity_folder"].parameters["properties"]["targetLanguage"]["enum"] == [
        "English",
        "Korean",
        "Japanese",
    ]
    assert specs["patch_translation_story_entity_folder"].parameters["properties"]["field"]["enum"] == ["name", "description"]


def test_all_translation_tool_schemas_require_target_language(monkeypatch) -> None:
    ctx = _module_context()
    monkeypatch.setattr(project_data_module, "is_translation_journey", lambda _ctx: True)
    monkeypatch.setattr(manuscript_module, "is_translation_journey", lambda _ctx: True)
    monkeypatch.setattr(outline_module, "is_translation_journey", lambda _ctx: True)
    monkeypatch.setattr(story_entity_module, "is_translation_journey", lambda _ctx: True)
    monkeypatch.setattr(timeline_module, "is_translation_journey", lambda _ctx: True)
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)

    modules = [
        ProjectDataFeatureModule(),
        ManuscriptFeatureModule(),
        OutlineFeatureModule(),
        StoryEntityFeatureModule(),
        TimelineFeatureModule(),
    ]
    specs = {
        binding.spec.name: binding.spec
        for module in modules
        for binding in module.list_bindings(ctx)
        if binding.meta.category == "translate"
    }

    expected_names = {
        "translate_basic_info",
        "patch_translation_basic_info",
        "translate_guidelines",
        "patch_translation_guidelines",
        "translate_manuscript",
        "patch_translation_manuscript",
        "translate_outline",
        "patch_translation_outline",
        "translate_story_entity",
        "translate_story_entity_folder",
        "patch_translation_story_entity",
        "patch_translation_story_entity_folder",
        "translate_timeline_track",
        "translate_timeline_event",
        "patch_translation_timeline_track",
        "patch_translation_timeline_event",
    }

    assert set(specs) == expected_names
    for spec in specs.values():
        assert "targetLanguage" in spec.parameters["required"]
        assert spec.parameters["properties"]["targetLanguage"]["enum"] == ["English", "Korean", "Japanese"]


def test_translation_tool_missing_target_language_fails_schema(monkeypatch) -> None:
    monkeypatch.setattr(outline_module, "is_translation_journey", lambda _ctx: True)
    binding = _binding_by_name(OutlineFeatureModule(), _module_context(), "translate_outline")

    result = validate_schema_required_enum_additional_properties(
        {
            "id": str(uuid4()),
            "name": "Translated name",
            "description": "Translated desc",
            "content": "Translated content",
        },
        binding.spec.parameters,
    )

    assert result.valid is False
    assert result.reason == "Missing required parameter: targetLanguage"


def test_translation_persisted_merge_key_uses_target_language(monkeypatch) -> None:
    monkeypatch.setattr(outline_module, "is_translation_journey", lambda _ctx: True)
    ctx = _module_context()
    binding = _binding_by_name(OutlineFeatureModule(), ctx, "translate_outline")
    args = {
        "targetLanguage": "Korean",
        "id": "outline-1",
        "name": "Translated name",
        "description": "Translated desc",
        "content": "Translated content",
    }

    meta = binding.build_persisted_meta(ctx, args)

    assert meta.merge_key == "outline:outline-1:Korean:translation"
    assert tool_language_for_args(binding, args, ctx.run.language, ctx.settings) == "Korean"


def test_non_translation_persisted_merge_key_uses_run_language() -> None:
    ctx = _module_context()
    binding = _binding_by_name(OutlineFeatureModule(), ctx, "patch_outline")
    args = {"id": "outline-1", "field": "content", "old": "Old", "new": "New"}

    meta = binding.build_persisted_meta(ctx, args)

    assert meta.merge_key == "outline:outline-1:English:draft"


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

    assert binding.spec.parameters["required"] == ["kind", "name", "description", "content"]

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
            "targetLanguage": "Korean",
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
                "name": "Chapter 1",
                "description": "Outline desc",
                "content": "**Timeline**: Months 44-46 - daily life as the community rebuilds.",
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


def test_timeline_replace_and_patch_schemas_include_structure_metadata(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    specs = {binding.spec.name: binding.spec for binding in TimelineFeatureModule().list_bindings(_module_context())}

    assert "read_timeline" not in specs
    assert "create_timeline_event_link" not in specs
    assert "delete_timeline_event_link" not in specs
    assert specs["read_timeline_track"].description == "Read a single timeline track with fields plus child track and event IDs."
    assert specs["read_timeline_event"].description == "Read a single timeline event with fields, dates, tags, and link IDs."

    assert specs["replace_timeline_track"].parameters["required"] == ["id"]
    assert specs["replace_timeline_event"].parameters["required"] == ["id"]

    create_event_params = specs["create_timeline_event"].parameters
    assert create_event_params["required"] == ["trackId", "name", "description", "content", "startDate"]
    create_event_links = create_event_params["properties"]["links"]
    assert create_event_links["type"] == "array"
    assert create_event_links["items"]["required"] == ["objectType", "objectId"]
    assert create_event_links["items"]["properties"]["objectType"]["enum"] == ["outline", "story_entity"]

    replace_track_props = specs["replace_timeline_track"].parameters["properties"]
    assert replace_track_props["parentId"]["type"] == ["string", "null"]
    assert replace_track_props["position"]["type"] == "integer"
    assert replace_track_props["color"]["type"] == ["string", "null"]

    replace_event_props = specs["replace_timeline_event"].parameters["properties"]
    for key in ("trackId", "startDate", "endDate", "tags", "links"):
        assert key in replace_event_props
    assert replace_event_props["links"]["items"]["properties"]["objectType"]["enum"] == ["outline", "story_entity"]
    date_props = replace_event_props["startDate"]["properties"]
    assert date_props["year"]["minimum"] == 1
    assert "maximum" not in date_props["year"]
    assert date_props["month"] == {"type": "integer", "minimum": 1, "maximum": 12}
    assert date_props["day"]["minimum"] == 1
    assert date_props["day"]["maximum"] == 31
    assert "year/month" in date_props["day"]["description"]
    assert date_props["hour"] == {"type": "integer", "minimum": 1, "maximum": 24}
    assert date_props["minute"] == {"type": "integer", "minimum": 1, "maximum": 60}

    for tool_name in ("patch_timeline_track", "patch_timeline_event"):
        params = specs[tool_name].parameters
        props = params["properties"]
        assert params["required"] == ["id", "field", "old", "new"]
        assert props["field"]["enum"] == ["name", "description", "content"]

    track_props = specs["patch_timeline_track"].parameters["properties"]
    for key in ("parentId", "position", "color"):
        assert key in track_props

    event_props = specs["patch_timeline_event"].parameters["properties"]
    for key in ("trackId", "startDate", "endDate", "tags"):
        assert key in event_props


def test_timeline_plan_mode_offer_is_read_only(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)

    registry = ToolRegistry()
    registry.register_module(TimelineFeatureModule())
    offer = registry.build_offer(_module_context(invocation_mode="planMode"))

    expected = {"read_timeline_event", "read_timeline_track"}
    assert {tool["name"] for tool in offer.provider_tools} == expected
    assert {
        (name, binding.meta.category)
        for name, binding in offer.bindings_by_name.items()
    } == {
        ("read_timeline_event", "read"),
        ("read_timeline_track", "read"),
    }


def test_timeline_translate_schemas_require_content(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(timeline_module, "is_translation_journey", lambda _ctx: True)
    specs = {binding.spec.name: binding.spec for binding in TimelineFeatureModule().list_bindings(_module_context())}

    for tool_name in ("translate_timeline_track", "translate_timeline_event"):
        params = specs[tool_name].parameters
        assert params["required"] == ["targetLanguage", "id", "name", "description", "content"]
        assert params["properties"]["targetLanguage"]["enum"] == ["English", "Korean", "Japanese"]
        assert params["properties"]["content"]["type"] == "string"

        missing_content = validate_schema_required_enum_additional_properties(
            {"targetLanguage": "Korean", "id": "target-1", "name": "Translated name", "description": "Translated desc"},
            params,
        )
        assert missing_content.valid is False
        assert "Missing required parameter: content" in str(missing_content.reason)

        explicit_empty_content = validate_schema_required_enum_additional_properties(
            {
                "targetLanguage": "Korean",
                "id": "target-1",
                "name": "Translated name",
                "description": "Translated desc",
                "content": "",
            },
            params,
        )
        assert explicit_empty_content.valid is True


class _TimelineProjectionQuery:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def all(self):
        return list(self._rows)


class _TimelineProjectionDb:
    def __init__(self, rows_by_model: dict[object, list[object]]) -> None:
        self._rows_by_model = rows_by_model

    def query(self, model):
        return _TimelineProjectionQuery(self._rows_by_model.get(model, []))


def test_read_timeline_track_returns_object_projection(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    track_id = uuid4()
    child_id = uuid4()
    event_id = uuid4()
    ctx = _execution_context()
    ctx.db = _TimelineProjectionDb(
        {
            timeline_module.TimelineTrack: [SimpleNamespace(id=child_id)],
            timeline_module.TimelineEvent: [SimpleNamespace(id=event_id)],
        }
    )

    def _fake_read_runtime_object(*_args, **kwargs):
        assert kwargs["object_type"] == "timeline_track"
        assert kwargs["object_id"] == track_id
        return {
            "metadata": {"parent_id": "parent-1", "position": 2, "color": "#336699"},
            "data": {
                "name": "Era",
                "description": "Only this track.",
                "content": "Track markdown.",
            },
        }

    monkeypatch.setattr(timeline_module, "read_runtime_object", _fake_read_runtime_object)
    binding = _binding_by_name(TimelineFeatureModule(), _module_context(), "read_timeline_track")

    outcome = asyncio.run(binding.execute({"id": str(track_id)}, ctx))

    result = outcome.result
    assert result["objectType"] == "timeline_track"
    obj = result["data"]["object"]
    assert obj == {
        "name": "Era",
        "description": "Only this track.",
        "content": "Track markdown.",
        "parentId": "parent-1",
        "position": 2,
        "color": "#336699",
        "childTrackIds": [str(child_id)],
        "eventIds": [str(event_id)],
    }
    assert "children" not in obj
    assert "events" not in obj
    assert "version" not in obj
    assert "metadata" not in obj


def test_read_timeline_event_returns_object_projection(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    event_id = uuid4()
    track_id = uuid4()
    link_id = uuid4()
    object_id = uuid4()
    ctx = _execution_context()
    ctx.db = _TimelineProjectionDb(
        {
            timeline_module.TimelineEventLink: [
                SimpleNamespace(id=link_id, object_type="outline", object_id=object_id),
            ],
        }
    )

    def _fake_read_runtime_object(*_args, **kwargs):
        assert kwargs["object_type"] == "timeline_event"
        assert kwargs["object_id"] == event_id
        return {
            "metadata": {
                "track_id": str(track_id),
                "start_date": {"year": 1, "month": 3},
                "end_date": None,
                "tags": ["court"],
            },
            "data": {
                "name": "Coronation",
                "description": "Single event.",
                "content": "Event markdown.",
            },
        }

    monkeypatch.setattr(timeline_module, "read_runtime_object", _fake_read_runtime_object)
    binding = _binding_by_name(TimelineFeatureModule(), _module_context(), "read_timeline_event")

    outcome = asyncio.run(binding.execute({"id": str(event_id)}, ctx))

    result = outcome.result
    assert result["objectType"] == "timeline_event"
    obj = result["data"]["object"]
    assert obj == {
        "name": "Coronation",
        "description": "Single event.",
        "content": "Event markdown.",
        "trackId": str(track_id),
        "startDate": {"year": 1, "month": 3},
        "endDate": None,
        "tags": ["court"],
        "links": [{"linkId": str(link_id), "objectType": "outline", "objectId": str(object_id)}],
    }
    assert "track" not in obj
    assert "siblings" not in obj
    assert "version" not in obj
    assert "metadata" not in obj


def test_create_timeline_event_persists_one_based_dates(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    feature = TimelineFeatureModule()
    binding = _binding_by_name(feature, _module_context(), "create_timeline_event")
    track_id = uuid4()
    object_id = uuid4()
    captured: dict[str, object] = {}

    def _fake_create_event(_db, **kwargs):
        captured.update(kwargs)
        return {"id": str(uuid4())}

    monkeypatch.setattr(timeline_module.timeline_service, "create_event", _fake_create_event)

    asyncio.run(
        binding.execute(
            {
                "trackId": str(track_id),
                "name": "Coronation",
                "description": "",
                "content": "",
                "startDate": {"year": 1, "month": 1, "day": 1},
                "endDate": {"year": 1, "month": 2, "day": 1},
                "tags": [],
                "links": [{"objectType": "outline", "objectId": str(object_id)}],
            },
            _execution_context(),
        )
    )

    assert captured["start_date"] == {"year": 1, "month": 1, "day": 1}
    assert captured["end_date"] == {"year": 1, "month": 2, "day": 1}
    assert captured["links"] == [{"object_type": "outline", "object_id": object_id}]


def test_create_timeline_event_rejects_invalid_create_links(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    binding = _binding_by_name(TimelineFeatureModule(), _module_context(), "create_timeline_event")
    result = asyncio.run(
        binding.validate(
            {
                "trackId": str(uuid4()),
                "name": "Coronation",
                "description": "",
                "content": "",
                "startDate": {"year": 1, "month": 1, "day": 1},
                "links": [{"objectType": "manuscript", "objectId": str(uuid4())}],
            },
            _validation_context(),
        )
    )

    assert result.valid is False
    assert "links.objectType must be outline or story_entity" in str(result.reason)


def test_timeline_event_tools_reject_invalid_gregorian_dates(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    feature = TimelineFeatureModule()

    create_binding = _binding_by_name(feature, _module_context(), "create_timeline_event")
    create_result = asyncio.run(
        create_binding.validate(
            {
                "trackId": str(uuid4()),
                "name": "Impossible date",
                "description": "",
                "content": "",
                "startDate": {"year": 2025, "month": 2, "day": 29},
            },
            _validation_context(),
        )
    )
    assert create_result.valid is False
    assert "Invalid startDate" in str(create_result.reason)

    replace_binding = _binding_by_name(feature, _module_context(), "replace_timeline_event")
    replace_result = asyncio.run(
        replace_binding.validate(
            {
                "id": str(uuid4()),
                "startDate": {"year": 2025, "month": 4, "day": 31},
            },
            _validation_context(),
        )
    )
    assert replace_result.valid is False
    assert "Invalid startDate" in str(replace_result.reason)

    patch_binding = _binding_by_name(feature, _module_context(), "patch_timeline_event")
    patch_result = asyncio.run(
        patch_binding.validate(
            {
                "id": str(uuid4()),
                "field": "description",
                "old": "old",
                "new": "new",
                "endDate": {"year": 2025, "month": 2, "day": 29},
            },
            _validation_context(),
        )
    )
    assert patch_result.valid is False
    assert "Invalid endDate" in str(patch_result.reason)

    range_result = asyncio.run(
        create_binding.validate(
            {
                "trackId": str(uuid4()),
                "name": "Backwards range",
                "description": "",
                "content": "",
                "startDate": {"year": 2025, "month": 3, "day": 1},
                "endDate": {"year": 2025, "month": 2, "day": 28},
            },
            _validation_context(),
        )
    )
    assert range_result.valid is False
    assert "endDate cannot be before startDate" in str(range_result.reason)


def test_validate_patch_timeline_event_reads_markdown_projection(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    captured: dict[str, object] = {}

    def _fake_read_runtime_object(*_args, **kwargs):
        captured["object_type"] = kwargs.get("object_type")
        return {
            "data": {
                "name": "Founding Day",
                "description": "A civic marker.",
                "content": "The bells ring once at dawn.",
            }
        }

    monkeypatch.setattr(timeline_module, "read_runtime_object", _fake_read_runtime_object)
    binding = _binding_by_name(TimelineFeatureModule(), _module_context(), "patch_timeline_event")

    result = asyncio.run(
        binding.validate(
            {
                "id": str(uuid4()),
                "field": "content",
                "old": "bells ring once",
                "new": "bells ring twice",
            },
            _validation_context(),
        )
    )

    assert result.valid is True
    assert captured["object_type"] == "timeline_event"


def test_validate_patch_timeline_track_rejects_non_unique_old_text(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)

    def _fake_read_runtime_object(*_args, **_kwargs):
        return {
            "data": {
                "name": "Era",
                "description": "repeat repeat",
                "content": "Track content.",
            }
        }

    monkeypatch.setattr(timeline_module, "read_runtime_object", _fake_read_runtime_object)
    binding = _binding_by_name(TimelineFeatureModule(), _module_context(), "patch_timeline_track")

    result = asyncio.run(
        binding.validate(
            {
                "id": str(uuid4()),
                "field": "description",
                "old": "repeat",
                "new": "echo",
            },
            _validation_context(),
        )
    )

    assert result.valid is False
    assert "multiple times" in str(result.reason)


def test_timeline_patch_group_uses_object_patch_batch(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    feature = TimelineFeatureModule()

    track_args = {
        "id": str(uuid4()),
        "field": "content",
        "old": "old text",
        "new": "new text",
        "parentId": "track-parent",
        "position": 2,
        "color": "#ffcc00",
    }
    track_binding = _binding_by_name(feature, _module_context(), "patch_timeline_track")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=timeline_module,
        feature=feature,
        binding=track_binding,
        args=track_args,
    )

    assert captured["object_type"] == "timeline_track"
    assert captured["replace_fields"] == {}
    assert captured["metadata"] == {"parent_id": "track-parent", "position": 2, "color": "#ffcc00"}
    assert captured["args"] == track_args
    assert captured["result"]["objectType"] == "timeline_track"

    event_args = {
        "id": str(uuid4()),
        "field": "description",
        "old": "old text",
        "new": "new text",
        "trackId": str(uuid4()),
        "startDate": {"year": 1, "month": 1, "day": 1},
        "endDate": None,
        "tags": ["war"],
    }
    event_binding = _binding_by_name(feature, _module_context(), "patch_timeline_event")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=timeline_module,
        feature=feature,
        binding=event_binding,
        args=event_args,
    )

    assert captured["object_type"] == "timeline_event"
    assert captured["replace_fields"] == {}
    assert captured["metadata"] == {
        "track_id": event_args["trackId"],
        "start_date": {"year": 1, "month": 1, "day": 1},
        "end_date": None,
        "tags": ["war"],
    }
    assert captured["args"] == event_args
    assert captured["result"]["objectType"] == "timeline_event"


def test_timeline_replace_group_uses_object_patch_batch(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    feature = TimelineFeatureModule()

    track_args = {
        "id": str(uuid4()),
        "name": "Era",
        "parentId": None,
        "position": 0,
        "color": None,
    }
    track_binding = _binding_by_name(feature, _module_context(), "replace_timeline_track")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=timeline_module,
        feature=feature,
        binding=track_binding,
        args=track_args,
    )

    assert captured["object_type"] == "timeline_track"
    assert captured["replace_fields"] == {"name": "Era"}
    assert captured["metadata"] == {"parent_id": None, "position": 0, "color": None}

    event_args = {
        "id": str(uuid4()),
        "trackId": str(uuid4()),
        "tags": ["politics", "court"],
        "links": [{"objectType": "outline", "objectId": str(uuid4())}],
    }
    event_binding = _binding_by_name(feature, _module_context(), "replace_timeline_event")
    captured = _capture_object_group(
        monkeypatch=monkeypatch,
        module_under_test=timeline_module,
        feature=feature,
        binding=event_binding,
        args=event_args,
    )

    assert captured["object_type"] == "timeline_event"
    assert captured["replace_fields"] == {}
    assert captured["metadata"] == {
        "track_id": event_args["trackId"],
        "tags": ["politics", "court"],
        "links": [{"object_type": "outline", "object_id": UUID(event_args["links"][0]["objectId"])}],
    }


def test_validate_replace_timeline_track_allows_metadata_only(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        timeline_module,
        "read_runtime_object",
        lambda *_args, **_kwargs: {"data": {"name": "Era", "description": "", "content": ""}},
    )
    binding = _binding_by_name(TimelineFeatureModule(), _module_context(), "replace_timeline_track")

    result = asyncio.run(
        binding.validate(
            {
                "id": str(uuid4()),
                "parentId": None,
                "position": 0,
                "color": None,
            },
            _validation_context(),
        )
    )

    assert result.valid is True


def test_validate_replace_timeline_event_allows_metadata_only(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        timeline_module,
        "read_runtime_object",
        lambda *_args, **_kwargs: {"data": {"name": "Event", "description": "", "content": ""}},
    )
    binding = _binding_by_name(TimelineFeatureModule(), _module_context(), "replace_timeline_event")

    result = asyncio.run(
        binding.validate(
            {
                "id": str(uuid4()),
                "links": [{"objectType": "story_entity", "objectId": str(uuid4())}],
            },
            _validation_context(),
        )
    )

    assert result.valid is True


def test_translate_timeline_tools_pass_markdown_content(monkeypatch) -> None:
    monkeypatch.setattr(timeline_module.timeline_service, "get_timeline", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(timeline_module, "is_translation_journey", lambda _ctx: True)
    feature = TimelineFeatureModule()
    ctx = _execution_context()
    captured: dict[str, dict[str, object]] = {}

    def _fake_update_track(_db, **kwargs):
        captured["track"] = kwargs
        return {"id": str(kwargs["track_id"])}

    def _fake_update_event(_db, **kwargs):
        captured["event"] = kwargs
        return {"id": str(kwargs["event_id"])}

    monkeypatch.setattr(timeline_module.timeline_service, "update_track", _fake_update_track)
    monkeypatch.setattr(timeline_module.timeline_service, "update_event", _fake_update_event)

    track_id = uuid4()
    event_id = uuid4()
    track_binding = _binding_by_name(feature, _module_context(), "translate_timeline_track")
    event_binding = _binding_by_name(feature, _module_context(), "translate_timeline_event")

    asyncio.run(
        track_binding.execute(
            {
                "targetLanguage": "Korean",
                "id": str(track_id),
                "name": "Translated track",
                "description": "Translated track desc",
                "content": "Translated track markdown",
            },
            ctx,
        )
    )
    asyncio.run(
        event_binding.execute(
            {
                "targetLanguage": "Korean",
                "id": str(event_id),
                "name": "Translated event",
                "description": "Translated event desc",
                "content": "Translated event markdown",
            },
            ctx,
        )
    )

    assert captured["track"]["track_id"] == track_id
    assert captured["track"]["name"] == "Translated track"
    assert captured["track"]["description"] == "Translated track desc"
    assert captured["track"]["content"] == "Translated track markdown"
    assert captured["track"]["rich_text_format"] == "markdown"
    assert captured["track"]["create_new_version"] is False
    assert captured["track"]["user_request"] == "tool:translate_timeline_track"

    assert captured["event"]["event_id"] == event_id
    assert captured["event"]["name"] == "Translated event"
    assert captured["event"]["description"] == "Translated event desc"
    assert captured["event"]["content"] == "Translated event markdown"
    assert captured["event"]["rich_text_format"] == "markdown"
    assert captured["event"]["create_new_version"] is False
    assert captured["event"]["user_request"] == "tool:translate_timeline_event"


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
            "targetLanguage": "Korean",
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

    assert '"parent_id": thread.parent_id' in source
    assert '"journey_kind": journey_runtime[0]' in source
    assert '"display_label": journey_runtime[1]' in source

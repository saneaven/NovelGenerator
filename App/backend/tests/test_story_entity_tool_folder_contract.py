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

from App.backend.services.tool_engine.contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from App.backend.services.tool_engine.modules import object_access
from App.backend.services.tool_engine.modules import (
    create_module,
    delete_module,
    patch_module,
    patch_translation_module,
    read_module,
    replace_module,
    translate_module,
)
from App.backend.services.tool_engine.modules.create_module import CreateToolCallModule
from App.backend.services.tool_engine.modules.delete_module import DeleteToolCallModule
from App.backend.services.tool_engine.modules.patch_module import PatchToolCallModule
from App.backend.services.tool_engine.modules.patch_translation_module import PatchTranslationToolCallModule
from App.backend.services.tool_engine.modules.read_module import ReadToolCallModule
from App.backend.services.tool_engine.modules.replace_module import ReplaceToolCallModule
from App.backend.services.tool_engine.modules.translate_module import TranslateToolCallModule


def _module_context() -> ToolModuleContext:
    return ToolModuleContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(),
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
        run=SimpleNamespace(),
        settings=SimpleNamespace(),
        tool_call_row=SimpleNamespace(),
        user_id=uuid4(),
        project_id=uuid4(),
        language="English",
    )


def _validation_context() -> ToolValidationContext:
    return ToolValidationContext(
        db=SimpleNamespace(),
        thread=SimpleNamespace(thread_type="agent"),
        run=SimpleNamespace(),
        settings=SimpleNamespace(),
        user_id=uuid4(),
        project_id=uuid4(),
        language="English",
    )


def test_story_entity_tool_schemas_include_optional_folder_id() -> None:
    ctx = _module_context()
    specs = {
        spec.name: spec
        for module in (CreateToolCallModule(), ReplaceToolCallModule(), PatchToolCallModule())
        for spec in module.list_tools(ctx)
    }

    assert specs["create_story_entity"].parameters["properties"]["folderId"]["type"] == ["string", "null"]
    assert specs["replace_story_entity"].parameters["properties"]["folderId"]["type"] == ["string", "null"]
    assert specs["patch_story_entity"].parameters["properties"]["folderId"]["type"] == ["string", "null"]


def test_story_entity_folder_tool_schemas_are_registered(monkeypatch) -> None:
    ctx = _module_context()
    monkeypatch.setattr(translate_module, "is_translation_journey", lambda _ctx: True)
    monkeypatch.setattr(patch_translation_module, "is_translation_journey", lambda _ctx: True)
    specs = {
        spec.name: spec
        for module in (
            CreateToolCallModule(),
            ReadToolCallModule(),
            ReplaceToolCallModule(),
            PatchToolCallModule(),
            DeleteToolCallModule(),
        )
        for spec in module.list_tools(ctx)
    }
    translate_specs = {
        spec.name: spec
        for module in (
            TranslateToolCallModule(),
            PatchTranslationToolCallModule(),
        )
        for spec in module.list_tools(_module_context())
    }

    assert specs["create_story_entity_folder"].parameters["required"] == ["name"]
    assert specs["create_story_entity_folder"].parameters["properties"]["parentId"]["type"] == ["string", "null"]
    assert specs["read_story_entity_folder"].parameters["required"] == ["id"]
    assert specs["replace_story_entity_folder"].parameters["properties"]["position"]["type"] == "integer"
    assert specs["patch_story_entity_folder"].parameters["properties"]["field"]["enum"] == ["name", "description"]
    assert specs["delete_story_entity_folder"].parameters["required"] == ["id"]
    assert translate_specs["translate_story_entity_folder"].parameters["required"] == ["id"]
    assert translate_specs["patch_translation_story_entity_folder"].parameters["properties"]["field"]["enum"] == ["name", "description"]


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

    monkeypatch.setattr(create_module.object_service, "create_object", _fake_create_object)

    result = asyncio.run(
        CreateToolCallModule().execute(
            "create_story_entity",
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
    assert result["data"]["kind"] == "character"


def test_create_story_entity_folder_passes_parent_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_create_object(*_args, **kwargs):
        captured.update(kwargs)
        return {"id": "folder-1"}

    monkeypatch.setattr(create_module.object_service, "create_object", _fake_create_object)

    result = asyncio.run(
        CreateToolCallModule().execute(
            "create_story_entity_folder",
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
    assert result["objectType"] == "story_entity_folder"


def test_create_outline_uses_markdown_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_create_object(*_args, **kwargs):
        captured.update(kwargs)
        return {"id": "outline-1", "metadata": {}}

    monkeypatch.setattr(create_module.object_service, "create_object", _fake_create_object)

    result = asyncio.run(
        CreateToolCallModule().execute(
            "create_outline",
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
    assert result["objectType"] == "outline"


def test_replace_story_entity_passes_folder_id_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        replace_module,
        "read_runtime_story_entity",
        lambda *_args, **_kwargs: {
            "kind": "character",
            "data": {
                "English": {
                    "name": "Ari",
                    "description": "Broker",
                    "content": "Detailed content",
                }
            },
        },
    )

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(replace_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        ReplaceToolCallModule().execute(
            "replace_story_entity",
            {
                "id": str(uuid4()),
                "kind": "character",
                "name": "Eira",
                "folderId": None,
            },
            _execution_context(),
        )
    )

    assert captured["metadata"] == {"folder_id": None}


def test_replace_story_entity_folder_passes_structural_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        replace_module,
        "read_story_entity_folder",
        lambda *_args, **_kwargs: {
            "metadata": {
                "parent_id": None,
                "display_order": 0,
            },
            "data": {
                "English": {
                    "name": "Main Cast",
                    "description": "Primary characters",
                }
            },
        },
    )

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(replace_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        ReplaceToolCallModule().execute(
            "replace_story_entity_folder",
            {
                "id": str(uuid4()),
                "parentId": "folder-archive",
                "position": 2,
            },
            _execution_context(),
        )
    )

    assert captured["metadata"] == {"parent_id": "folder-archive", "display_order": 2}
    assert "rich_text_format" not in captured
    assert captured["data"] == {}


def test_patch_story_entity_passes_folder_id_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        patch_module,
        "read_runtime_story_entity",
        lambda *_args, **_kwargs: {
            "kind": "character",
            "data": {
                "English": {
                    "name": "Ari",
                    "description": "Broker",
                    "content": "Detailed content",
                }
            },
        },
    )

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(patch_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        PatchToolCallModule().execute(
            "patch_story_entity",
            {
                "id": str(uuid4()),
                "kind": "character",
                "field": "content",
                "old": "Detailed",
                "new": "Updated",
                "folderId": "folder-main-cast",
            },
            _execution_context(),
        )
    )

    assert captured["metadata"] == {"folder_id": "folder-main-cast"}


def test_patch_story_entity_folder_passes_structural_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        patch_module,
        "read_story_entity_folder",
        lambda *_args, **_kwargs: {
            "metadata": {
                "parent_id": None,
                "display_order": 0,
            },
            "data": {
                "English": {
                    "name": "Main Cast",
                    "description": "Primary characters",
                }
            },
        },
    )

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(patch_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        PatchToolCallModule().execute(
            "patch_story_entity_folder",
            {
                "id": str(uuid4()),
                "field": "description",
                "old": "Primary",
                "new": "Core",
                "parentId": None,
                "position": 1,
            },
            _execution_context(),
        )
    )

    assert captured["metadata"] == {"parent_id": None, "display_order": 1}
    assert "rich_text_format" not in captured
    assert captured["data"]["description"] == "Core characters"


def test_translate_story_entity_folder_execute_omits_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        translate_module,
        "read_story_entity_folder",
        lambda *_args, **_kwargs: {
            "data": {
                "English": {
                    "name": "Main Cast",
                    "description": "Primary characters",
                }
            },
        },
    )

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(translate_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        TranslateToolCallModule().execute(
            "translate_story_entity_folder",
            {
                "id": str(uuid4()),
                "name": "Main Cast KR",
            },
            _execution_context(),
        )
    )

    assert "rich_text_format" not in captured
    assert captured["data"]["name"] == "Main Cast KR"


def test_patch_translation_story_entity_folder_execute_omits_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        patch_translation_module,
        "read_story_entity_folder",
        lambda *_args, **_kwargs: {
            "data": {
                "English": {
                    "name": "Main Cast",
                    "description": "Primary characters",
                }
            },
        },
    )

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(patch_translation_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        PatchTranslationToolCallModule().execute(
            "patch_translation_story_entity_folder",
            {
                "id": str(uuid4()),
                "field": "description",
                "old": "Primary",
                "new": "Core",
            },
            _execution_context(),
        )
    )

    assert "rich_text_format" not in captured
    assert captured["data"]["description"] == "Core characters"


def test_validate_patch_outline_reads_markdown_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_read_object(*_args, **kwargs):
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

    monkeypatch.setattr(patch_module, "read_runtime_object", _fake_read_object)

    result = asyncio.run(
        PatchToolCallModule().validate(
            "patch_outline",
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


def test_patch_outline_execute_writes_markdown_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        patch_module,
        "read_runtime_object",
        lambda *_args, **kwargs: {
            "kind": "chapter",
            "data": {
                "English": {
                    "name": "Chapter 1",
                    "description": "Outline desc",
                    "content": "**Timeline**: Months 44-46 - daily life as the community rebuilds.",
                }
            },
            "__read_format__": kwargs.get("rich_text_format"),
        },
    )

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(patch_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        PatchToolCallModule().execute(
            "patch_outline",
            {
                "id": str(uuid4()),
                "field": "content",
                "old": "**Timeline**: Months 44-46 - daily life as the community rebuilds.",
                "new": "**Timeline**: Months 44-46 - daily routines as the community rebuilds.",
            },
            _execution_context(),
        )
    )

    assert captured["rich_text_format"] == "markdown"
    assert "daily routines as the community rebuilds" in captured["data"]["content"]


def test_replace_outline_execute_writes_markdown_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}
    read_calls: list[dict[str, object]] = []

    def _fake_read_object(*_args, **kwargs):
        read_calls.append({"called": True})
        return {
            "kind": "chapter",
            "data": {
                "English": {
                    "name": "Chapter 1",
                    "description": "Outline desc",
                    "content": "Old markdown",
                }
            },
        }

    monkeypatch.setattr(replace_module, "read_runtime_object", _fake_read_object)

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(replace_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        ReplaceToolCallModule().execute(
            "replace_outline",
            {
                "id": str(uuid4()),
                "content": "## New outline content",
            },
            _execution_context(),
        )
    )

    assert read_calls[-1]["called"] is True
    assert captured["rich_text_format"] == "markdown"
    assert captured["data"]["content"] == "## New outline content"


def test_translate_outline_execute_writes_markdown_projection(monkeypatch) -> None:
    captured: dict[str, object] = {}
    read_calls: list[dict[str, object]] = []

    def _fake_read_object(*_args, **kwargs):
        read_calls.append({"called": True})
        return {
            "kind": "chapter",
            "data": {
                "English": {
                    "name": "Chapter 1",
                    "description": "Outline desc",
                    "content": "Old markdown",
                }
            },
        }

    monkeypatch.setattr(translate_module, "read_runtime_object", _fake_read_object)

    def _fake_update_object(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(translate_module.object_service, "update_object", _fake_update_object)

    asyncio.run(
        TranslateToolCallModule().execute(
            "translate_outline",
            {
                "id": str(uuid4()),
                "name": "Chapter 1",
                "description": "Translated desc",
                "content": "Translated markdown",
            },
            _execution_context(),
        )
    )

    assert read_calls[-1]["called"] is True
    assert captured["rich_text_format"] == "markdown"
    assert captured["data"]["content"] == "Translated markdown"


def test_thread_route_runtime_payload_includes_parent_metadata() -> None:
    source = (ROOT / "App" / "backend" / "routes" / "thread_routes.py").read_text(encoding="utf-8")

    assert 'runtime_fields["parent_id"]' in source
    assert 'runtime_fields["journey_kind"]' in source
    assert 'runtime_fields["display_label"]' in source

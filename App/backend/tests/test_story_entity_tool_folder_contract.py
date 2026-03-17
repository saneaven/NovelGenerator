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

fake_sidecar_client = types.ModuleType("App.backend.services.sidecar_client")
fake_sidecar_client.SidecarClient = object
fake_sidecar_client.sidecar_client = SimpleNamespace()
sys.modules.setdefault("App.backend.services.sidecar_client", fake_sidecar_client)

fake_pil = types.ModuleType("PIL")
fake_pil.Image = object
fake_pil.ImageOps = object
sys.modules.setdefault("PIL", fake_pil)

fake_mistune = types.ModuleType("mistune")
fake_mistune.create_markdown = lambda *_args, **_kwargs: None
sys.modules.setdefault("mistune", fake_mistune)

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


fake_manuscript_access.patch_manuscript = _fake_patch_manuscript
fake_manuscript_access.replace_manuscript = _fake_replace_manuscript
fake_manuscript_access.validate_patch_args = _fake_validate_patch_args
fake_manuscript_access.ensure_manuscript_exists = lambda *_args, **_kwargs: None
sys.modules.setdefault("App.backend.services.tool_engine.modules.manuscript_access", fake_manuscript_access)

from App.backend.services.tool_engine.contexts import ToolExecutionContext, ToolModuleContext
from App.backend.services.tool_engine.modules import create_module, patch_module, replace_module
from App.backend.services.tool_engine.modules.create_module import CreateToolCallModule
from App.backend.services.tool_engine.modules.patch_module import PatchToolCallModule
from App.backend.services.tool_engine.modules.replace_module import ReplaceToolCallModule


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
    assert result["data"]["kind"] == "character"


def test_replace_story_entity_passes_folder_id_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        replace_module,
        "read_story_entity",
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


def test_patch_story_entity_passes_folder_id_metadata(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        patch_module,
        "read_story_entity",
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


def test_thread_route_batch_contract_extracts_story_entity_folder_id_metadata() -> None:
    source = (ROOT / "App" / "backend" / "routes" / "thread_routes.py").read_text(encoding="utf-8")

    assert "def _extract_story_entity_metadata(args: dict) -> dict | None:" in source
    assert 'meta["folder_id"] = args.get("folderId")' in source
    assert "_extract_story_entity_metadata(args)" in source

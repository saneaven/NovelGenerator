from __future__ import annotations

import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import declarative_base


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    deletion_service = types.ModuleType("App.backend.services.deletion_service")
    deletion_service.collect_act_subtree_object_ids = lambda *_args, **_kwargs: {}
    deletion_service.collect_chapter_subtree_object_ids = lambda *_args, **_kwargs: {}
    deletion_service.collect_outline_subtree_object_ids = lambda *_args, **_kwargs: {}
    deletion_service.delete_assets_with_files = lambda *_args, **_kwargs: None
    deletion_service.delete_object_versions_bulk = lambda *_args, **_kwargs: None
    deletion_service.delete_semantic_sources_bulk = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.deletion_service"] = deletion_service

    semantic_index_service = types.ModuleType("App.backend.services.semantic_index_service")

    async def _index_object(*_args, **_kwargs) -> None:
        return None

    semantic_index_service.index_object = _index_object
    semantic_index_service.invalidate_object_index = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.semantic_index_service"] = semantic_index_service

    object_change_events = types.ModuleType("App.backend.services.object_change_events")
    object_change_events.queue_object_change = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.object_change_events"] = object_change_events

    credential_service = types.ModuleType("App.backend.services.credential_service")

    class CredentialServiceError(RuntimeError):
        pass

    credential_service.CredentialServiceError = CredentialServiceError
    credential_service.credential_service = SimpleNamespace(get_provider_config=lambda *_args, **_kwargs: {})
    sys.modules["App.backend.services.credential_service"] = credential_service

    settings_service = types.ModuleType("App.backend.services.settings_service")
    settings_service.settings_service = SimpleNamespace(
        is_vector_storage_enabled=lambda *_args, **_kwargs: False,
        get_search_embedding_config=lambda *_args, **_kwargs: SimpleNamespace(provider=None, model=None),
    )
    sys.modules["App.backend.services.settings_service"] = settings_service

    storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")
    storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
    storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
    storage_usage_service.build_asset_rows_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_object_version_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_story_core_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_story_core_rows_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_usage_delta_for_measurement_rows = lambda *_args, **_kwargs: None
    storage_usage_service.measure_object_version_row = lambda *_args, **_kwargs: 0
    storage_usage_service.snapshot_asset_row = lambda *_args, **_kwargs: None
    storage_usage_service.snapshot_object_version_row = lambda *_args, **_kwargs: None
    storage_usage_service.snapshot_rows = lambda rows, snapshot_fn: [snapshot_fn(row) for row in rows]
    storage_usage_service.snapshot_story_core_row = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.storage_usage_service"] = storage_usage_service


_install_import_stubs()

import App.backend.services.object_service as object_service_module
from App.backend.models.db_models import RichTextImageRef


class FakeQuery:
    def __init__(self, rows: list[object] | None = None) -> None:
        self._rows = list(rows or [])

    def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def order_by(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def delete(self, *_args: object, **_kwargs: object) -> int:
        return 0

    def all(self) -> list[object]:
        return list(self._rows)


class FakeSession:
    def __init__(self) -> None:
        self.queried_models: list[object] = []

    def query(self, model: object) -> FakeQuery:
        self.queried_models.append(model)
        return FakeQuery()


class FakeFirstQuery:
    def __init__(self, row: object | None) -> None:
        self._row = row

    def filter(self, *_args: object, **_kwargs: object) -> "FakeFirstQuery":
        return self

    def first(self) -> object | None:
        return self._row


class FakeCreateSession:
    def __init__(self, project: object) -> None:
        self.project = project
        self.added: list[object] = []

    def query(self, model: object) -> FakeFirstQuery:
        if model is object_service_module.Project:
            return FakeFirstQuery(self.project)
        return FakeFirstQuery(None)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        return None


def test_update_object_manuscript_path_uses_rich_text_image_refs(monkeypatch) -> None:
    db = FakeSession()
    project_id = uuid4()
    object_id = uuid4()
    user_id = uuid4()

    manuscript = SimpleNamespace(
        updated_at=None,
        chapter=SimpleNamespace(
            act=SimpleNamespace(
                outline=SimpleNamespace(project_id=project_id),
            ),
        ),
    )

    usage_calls: list[dict[str, object]] = []
    invalidations: list[dict[str, object]] = []

    monkeypatch.setattr(object_service_module, "_load_owned_object", lambda *_args, **_kwargs: manuscript)
    monkeypatch.setattr(object_service_module, "_latest_version", lambda *_args, **_kwargs: SimpleNamespace())
    monkeypatch.setattr(object_service_module, "snapshot_object_version_row", lambda *_args, **_kwargs: {"snap": "version"})
    monkeypatch.setattr(object_service_module, "_create_or_update_version", lambda *_args, **_kwargs: SimpleNamespace())
    monkeypatch.setattr(
        object_service_module,
        "rebuild_rich_text_refs_for_object",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        object_service_module,
        "_invalidate_semantic_index",
        lambda *_args, **kwargs: invalidations.append(kwargs),
    )
    monkeypatch.setattr(object_service_module, "_queue_semantic_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(object_service_module, "queue_object_change", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(object_service_module, "build_object_version_delta", lambda *_args, **_kwargs: "version-delta")
    monkeypatch.setattr(
        object_service_module,
        "apply_project_usage_deltas",
        lambda *_args, **kwargs: usage_calls.append(kwargs),
    )
    monkeypatch.setattr(
        object_service_module,
        "_serialize_object",
        lambda *_args, **_kwargs: {"id": str(object_id), "type": "manuscript"},
    )

    result = object_service_module.object_service.update_object(
        db,
        project_id=project_id,
        object_type="manuscript",
        object_id=object_id,
        data={"content": {"type": "doc", "content": [{"type": "paragraph"}]}, "wordCount": 0},
        language="Korean",
        user_request="raw:objectTranslation",
        create_new_version=False,
        created_by=user_id,
    )

    assert result == {"id": str(object_id), "type": "manuscript"}
    assert db.queried_models.count(RichTextImageRef) == 2
    assert len(usage_calls) == 1
    assert invalidations == [
        {
            "user_id": user_id,
            "project_id": project_id,
            "object_type": "manuscript",
            "object_id": object_id,
        }
    ]


def test_update_object_structure_story_entity_folder_skips_versioning(monkeypatch) -> None:
    db = FakeSession()
    project_id = uuid4()
    object_id = uuid4()
    user_id = uuid4()

    folder = SimpleNamespace(
        id=object_id,
        project_id=project_id,
        parent_id=None,
        display_order=0,
        updated_at=None,
    )

    metadata_calls: list[dict[str, object]] = []
    change_calls: list[dict[str, object]] = []

    monkeypatch.setattr(object_service_module, "_load_owned_object", lambda *_args, **_kwargs: folder)
    monkeypatch.setattr(
        object_service_module,
        "_handle_metadata_update",
        lambda _db, object_type, incoming_object_id, obj, metadata: metadata_calls.append(
            {
                "object_type": object_type,
                "object_id": incoming_object_id,
                "object": obj,
                "metadata": metadata,
            }
        ),
    )
    monkeypatch.setattr(
        object_service_module,
        "queue_object_change",
        lambda *_args, **kwargs: change_calls.append(kwargs),
    )
    monkeypatch.setattr(
        object_service_module,
        "_serialize_object",
        lambda *_args, **_kwargs: {"id": str(object_id), "type": "story_entity_folder"},
    )
    monkeypatch.setattr(
        object_service_module,
        "_create_or_update_version",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("version update should not run")),
    )

    result = object_service_module.object_service.update_object_structure(
        db,
        project_id=project_id,
        object_type="story_entity_folder",
        object_id=object_id,
        metadata={"parent_id": None, "display_order": 3},
        created_by=user_id,
    )

    assert result == {"id": str(object_id), "type": "story_entity_folder"}
    assert metadata_calls == [
        {
            "object_type": "story_entity_folder",
            "object_id": object_id,
            "object": folder,
            "metadata": {"parent_id": None, "display_order": 3},
        }
    ]
    assert change_calls == [
        {
            "user_id": user_id,
            "project_id": project_id,
            "object_type": "story_entity_folder",
            "object_id": object_id,
            "action": "updated",
        }
    ]


def test_create_outline_queues_updated_events_for_affected_siblings(monkeypatch) -> None:
    project_id = uuid4()
    project_user_id = uuid4()
    sibling_id = uuid4()
    db = FakeCreateSession(SimpleNamespace(id=project_id, user_id=project_user_id))

    queue_calls: list[dict[str, object]] = []

    monkeypatch.setattr(object_service_module, "resolve_outline_parent", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(object_service_module, "insert_outline_position", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(object_service_module, "_queue_semantic_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        object_service_module,
        "collect_affected_outline_rows",
        lambda *_args, **_kwargs: [
            db.added[0],
            SimpleNamespace(id=sibling_id),
        ],
    )
    monkeypatch.setattr(
        object_service_module,
        "queue_object_change",
        lambda *_args, **kwargs: queue_calls.append(kwargs),
    )
    monkeypatch.setattr(
        object_service_module,
        "_serialize_object",
        lambda *_args, **_kwargs: {"id": str(db.added[0].id), "type": "outline"},
    )
    monkeypatch.setattr(object_service_module, "rebuild_rich_text_refs_for_object", lambda *_args, **_kwargs: None)

    result = object_service_module.object_service.create_object(
        db,
        project_id=project_id,
        object_type="outline",
        data={"name": "Outline", "description": "", "content": ""},
        language="English",
        kind="outline",
        created_by=None,
    )

    assert result["type"] == "outline"
    assert queue_calls[0]["action"] == "created"
    assert queue_calls[0]["object_type"] == "outline"
    assert queue_calls[0]["object_id"] == db.added[0].id
    assert queue_calls[1:] == [
        {
            "user_id": project_user_id,
            "project_id": project_id,
            "object_type": "outline",
            "object_id": sibling_id,
            "action": "updated",
        }
    ]


def test_update_outline_structure_queues_updated_events_for_affected_siblings(monkeypatch) -> None:
    db = FakeSession()
    project_id = uuid4()
    object_id = uuid4()
    user_id = uuid4()
    old_parent_id = uuid4()
    new_parent_id = uuid4()
    sibling_a_id = uuid4()
    sibling_b_id = uuid4()

    outline_before = SimpleNamespace(
        id=object_id,
        project_id=project_id,
        kind="chapter",
        parent_id=old_parent_id,
        updated_at=None,
    )
    outline_after = SimpleNamespace(
        id=object_id,
        project_id=project_id,
        kind="chapter",
        parent_id=new_parent_id,
        updated_at=None,
    )

    load_calls = {"count": 0}
    queue_calls: list[dict[str, object]] = []

    def fake_load(*_args: object, **_kwargs: object) -> object:
        load_calls["count"] += 1
        return outline_before if load_calls["count"] == 1 else outline_after

    monkeypatch.setattr(object_service_module, "_load_owned_object", fake_load)
    monkeypatch.setattr(object_service_module, "_handle_metadata_update", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        object_service_module,
        "_serialize_object",
        lambda *_args, **_kwargs: {
            "id": str(object_id),
            "type": "outline",
            "data": {"English": {"name": "Chapter", "description": "", "content": ""}},
        },
    )
    monkeypatch.setattr(object_service_module, "_create_or_update_version", lambda *_args, **_kwargs: SimpleNamespace())
    monkeypatch.setattr(object_service_module, "_invalidate_semantic_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(object_service_module, "_queue_semantic_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(object_service_module, "rebuild_rich_text_refs_for_object", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        object_service_module,
        "collect_affected_outline_rows",
        lambda *_args, **_kwargs: [
            SimpleNamespace(id=sibling_a_id),
            outline_after,
            SimpleNamespace(id=sibling_b_id),
        ],
    )
    monkeypatch.setattr(
        object_service_module,
        "queue_object_change",
        lambda *_args, **kwargs: queue_calls.append(kwargs),
    )

    result = object_service_module.object_service.update_object(
        db,
        project_id=project_id,
        object_type="outline",
        object_id=object_id,
        data={},
        language="English",
        metadata={"parent_id": str(new_parent_id), "position": 0},
        created_by=user_id,
    )

    assert result["type"] == "outline"
    assert queue_calls == [
        {
            "user_id": user_id,
            "project_id": project_id,
            "object_type": "outline",
            "object_id": sibling_a_id,
            "action": "updated",
        },
        {
            "user_id": user_id,
            "project_id": project_id,
            "object_type": "outline",
            "object_id": object_id,
            "action": "updated",
        },
        {
            "user_id": user_id,
            "project_id": project_id,
            "object_type": "outline",
            "object_id": sibling_b_id,
            "action": "updated",
        },
    ]

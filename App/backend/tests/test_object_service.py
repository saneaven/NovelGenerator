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
    deletion_service.delete_rag_sources_bulk = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.deletion_service"] = deletion_service

    manuscript_image_index_service = types.ModuleType("App.backend.services.manuscript_image_index_service")
    manuscript_image_index_service.rebuild_manuscript_images_for_language = lambda **_kwargs: None
    sys.modules["App.backend.services.manuscript_image_index_service"] = manuscript_image_index_service

    rag_index_service = types.ModuleType("App.backend.services.rag_index_service")

    async def _index_object(*_args, **_kwargs) -> None:
        return None

    rag_index_service.index_object = _index_object
    sys.modules["App.backend.services.rag_index_service"] = rag_index_service

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
        get_rag_settings=lambda *_args, **_kwargs: SimpleNamespace(enabled=False),
        get_embedding_config=lambda *_args, **_kwargs: SimpleNamespace(provider=None, model=None),
    )
    sys.modules["App.backend.services.settings_service"] = settings_service

    storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")
    storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
    storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
    storage_usage_service.build_asset_rows_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_manuscript_images_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_object_version_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_story_core_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_story_core_rows_delta = lambda *_args, **_kwargs: None
    storage_usage_service.build_usage_delta_for_measurement_rows = lambda *_args, **_kwargs: None
    storage_usage_service.measure_object_version_row = lambda *_args, **_kwargs: 0
    storage_usage_service.snapshot_asset_row = lambda *_args, **_kwargs: None
    storage_usage_service.snapshot_manuscript_image_row = lambda *_args, **_kwargs: None
    storage_usage_service.snapshot_object_version_row = lambda *_args, **_kwargs: None
    storage_usage_service.snapshot_rows = lambda rows, snapshot_fn: [snapshot_fn(row) for row in rows]
    storage_usage_service.snapshot_story_core_row = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.storage_usage_service"] = storage_usage_service


_install_import_stubs()

import App.backend.services.object_service as object_service_module
from App.backend.models.db_models import ManuscriptImage


class FakeQuery:
    def __init__(self, rows: list[object] | None = None) -> None:
        self._rows = list(rows or [])

    def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def all(self) -> list[object]:
        return list(self._rows)


class FakeSession:
    def __init__(self) -> None:
        self.queried_models: list[object] = []

    def query(self, model: object) -> FakeQuery:
        self.queried_models.append(model)
        return FakeQuery()


def test_update_object_manuscript_path_uses_manuscript_image_model(monkeypatch) -> None:
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

    monkeypatch.setattr(object_service_module, "_load_owned_object", lambda *_args, **_kwargs: manuscript)
    monkeypatch.setattr(object_service_module, "_latest_version", lambda *_args, **_kwargs: SimpleNamespace())
    monkeypatch.setattr(object_service_module, "snapshot_object_version_row", lambda *_args, **_kwargs: {"snap": "version"})
    monkeypatch.setattr(object_service_module, "_create_or_update_version", lambda *_args, **_kwargs: SimpleNamespace())
    monkeypatch.setattr(
        object_service_module,
        "rebuild_manuscript_images_for_language",
        lambda **_kwargs: None,
    )
    monkeypatch.setattr(object_service_module, "_queue_rag_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(object_service_module, "queue_object_change", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(object_service_module, "build_object_version_delta", lambda *_args, **_kwargs: "version-delta")
    monkeypatch.setattr(object_service_module, "build_manuscript_images_delta", lambda *_args, **_kwargs: "image-delta")
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
        data={"doc": {"type": "doc", "content": []}, "wordCount": 0},
        language="Korean",
        user_request="raw:objectTranslation",
        create_new_version=False,
        created_by=user_id,
    )

    assert result == {"id": str(object_id), "type": "manuscript"}
    assert db.queried_models.count(ManuscriptImage) == 2
    assert len(usage_calls) == 1

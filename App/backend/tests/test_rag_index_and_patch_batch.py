from __future__ import annotations

import asyncio
import os
import sys
import types
from contextlib import contextmanager
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
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    rag_chunker = types.ModuleType("App.backend.services.rag_chunker")
    rag_chunker.merge_blocks_by_length = lambda blocks, **_kwargs: list(blocks)
    rag_chunker.split_markdown_blocks = lambda text: [text] if text else []
    rag_chunker.split_plaintext_blocks = lambda text: [text] if text else []
    sys.modules["App.backend.services.rag_chunker"] = rag_chunker

    rag_embedding_service = types.ModuleType("App.backend.services.rag_embedding_service")

    async def _embed_many(**_kwargs):
        return []

    rag_embedding_service.embed_many = _embed_many
    sys.modules["App.backend.services.rag_embedding_service"] = rag_embedding_service

    common_object_helpers = types.ModuleType("App.backend.services.tool_engine.modules.common_object_helpers")
    common_object_helpers.extract_lang_data = lambda obj, _language: obj
    common_object_helpers.read_object = lambda *_args, **_kwargs: {}
    sys.modules["App.backend.services.tool_engine.modules.common_object_helpers"] = common_object_helpers


_install_import_stubs()

from App.backend.models.rag_models import RagChunk
from App.backend.services import rag_index_service
from App.backend.services.object_patch_batch import ObjectPatchBatch, ObjectPatchState


class FakeRagQuery:
    def __init__(self, session: "FakeRagSession", model: object) -> None:
        self._session = session
        self._model = model

    def filter(self, *_args: object, **_kwargs: object) -> "FakeRagQuery":
        return self

    def delete(self, **_kwargs: object) -> int:
        if self._model is RagChunk:
            self._session.deleted_chunk_rows += 1
        return 1


class FakeRagSession:
    def __init__(self) -> None:
        self.commits = 0
        self.deleted_chunk_rows = 0
        self.added: list[object] = []
        self.connection_checked_out = True

    def query(self, model: object) -> FakeRagQuery:
        return FakeRagQuery(self, model)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        return None

    def commit(self) -> None:
        self.commits += 1
        self.connection_checked_out = False


def test_index_object_commits_before_embedding(monkeypatch) -> None:
    db = FakeRagSession()
    source = SimpleNamespace(id=uuid4(), content_hash=None, index_state="ready", version_number=None, indexed_at=None)
    latest = SimpleNamespace(version_number=1, data={"English": {"content": "alpha"}})

    monkeypatch.setattr(rag_index_service, "get_embedding_profile", lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": None})
    monkeypatch.setattr(rag_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(rag_index_service, "_latest_version", lambda *_args, **_kwargs: latest)
    monkeypatch.setattr(rag_index_service, "compute_order_meta", lambda *_args, **_kwargs: rag_index_service.OrderMeta(type_group="story_object"))
    monkeypatch.setattr(rag_index_service, "_upsert_source", lambda *_args, **_kwargs: source)
    monkeypatch.setattr(rag_index_service, "extract_index_text", lambda *_args, **_kwargs: {"content": "alpha"})
    monkeypatch.setattr(rag_index_service, "chunk_fields", lambda _text_by_field: [{"field_path": "content", "chunk_index": 0, "text": "alpha"}])
    monkeypatch.setattr(
        rag_index_service,
        "compute_chunks_hash",
        lambda chunks: "|".join(str(chunk.get("text") or "") for chunk in chunks),
    )
    monkeypatch.setattr(rag_index_service, "set_embedding_dimensions", lambda *_args, **_kwargs: None)

    async def _fake_embed_many(**_kwargs):
        assert db.commits == 1
        assert db.connection_checked_out is False
        return [[0.1, 0.2]]

    monkeypatch.setattr(rag_index_service, "embed_many", _fake_embed_many)

    result = asyncio.run(
        rag_index_service.index_object(
            db,
            user_id=uuid4(),
            project_id=uuid4(),
            object_type="character",
            object_id=uuid4(),
            provider_config={"api_key": "x"},
            force=False,
        )
    )

    assert result == {"rebuilt": True, "skipped": False, "missing_main_language": False}
    assert db.deleted_chunk_rows == 1
    assert len(db.added) == 1


def test_index_object_returns_stale_when_latest_version_changes(monkeypatch) -> None:
    db = FakeRagSession()
    source = SimpleNamespace(id=uuid4(), content_hash=None, index_state="ready", version_number=None, indexed_at=None)
    latest_versions = [
        SimpleNamespace(version_number=1, data={"English": {"content": "alpha"}}),
        SimpleNamespace(version_number=2, data={"English": {"content": "beta"}}),
    ]

    monkeypatch.setattr(rag_index_service, "get_embedding_profile", lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": None})
    monkeypatch.setattr(rag_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(rag_index_service, "_latest_version", lambda *_args, **_kwargs: latest_versions.pop(0))
    monkeypatch.setattr(rag_index_service, "compute_order_meta", lambda *_args, **_kwargs: rag_index_service.OrderMeta(type_group="story_object"))
    monkeypatch.setattr(rag_index_service, "_upsert_source", lambda *_args, **_kwargs: source)
    monkeypatch.setattr(
        rag_index_service,
        "extract_index_text",
        lambda _object_type, data, _language: {"content": next(iter(data.values())).get("content", "")},
    )
    monkeypatch.setattr(
        rag_index_service,
        "chunk_fields",
        lambda text_by_field: [{"field_path": "content", "chunk_index": 0, "text": text_by_field["content"]}],
    )
    monkeypatch.setattr(
        rag_index_service,
        "compute_chunks_hash",
        lambda chunks: "|".join(str(chunk.get("text") or "") for chunk in chunks),
    )

    async def _fake_embed_many(**_kwargs):
        return [[0.1, 0.2]]

    monkeypatch.setattr(rag_index_service, "embed_many", _fake_embed_many)

    result = asyncio.run(
        rag_index_service.index_object(
            db,
            user_id=uuid4(),
            project_id=uuid4(),
            object_type="character",
            object_id=uuid4(),
            provider_config={"api_key": "x"},
            force=False,
        )
    )

    assert result == {
        "rebuilt": False,
        "skipped": True,
        "missing_main_language": False,
        "stale": True,
    }
    assert db.deleted_chunk_rows == 0
    assert db.added == []


def test_index_object_skips_missing_main_language_without_embedding(monkeypatch) -> None:
    db = FakeRagSession()
    source = SimpleNamespace(id=uuid4(), content_hash="old", index_state="ready", version_number=None, indexed_at=None)
    latest = SimpleNamespace(version_number=3, data={"English": {"content": "alpha"}})
    embed_called = {"value": False}

    monkeypatch.setattr(rag_index_service, "get_embedding_profile", lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": None})
    monkeypatch.setattr(rag_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(rag_index_service, "_latest_version", lambda *_args, **_kwargs: latest)
    monkeypatch.setattr(rag_index_service, "compute_order_meta", lambda *_args, **_kwargs: rag_index_service.OrderMeta(type_group="story_object"))
    monkeypatch.setattr(rag_index_service, "_upsert_source", lambda *_args, **_kwargs: source)
    monkeypatch.setattr(rag_index_service, "extract_index_text", lambda *_args, **_kwargs: {})

    async def _fake_embed_many(**_kwargs):
        embed_called["value"] = True
        return [[0.1, 0.2]]

    monkeypatch.setattr(rag_index_service, "embed_many", _fake_embed_many)

    result = asyncio.run(
        rag_index_service.index_object(
            db,
            user_id=uuid4(),
            project_id=uuid4(),
            object_type="character",
            object_id=uuid4(),
            provider_config={"api_key": "x"},
            force=False,
        )
    )

    assert result == {"rebuilt": False, "skipped": True, "missing_main_language": True}
    assert embed_called["value"] is False
    assert db.deleted_chunk_rows == 1
    assert source.content_hash is None
    assert source.version_number == 3


def test_index_object_marks_source_error_when_embedding_raises(monkeypatch) -> None:
    db = FakeRagSession()
    source = SimpleNamespace(
        id=uuid4(),
        content_hash=None,
        index_state="ready",
        version_number=None,
        indexed_at=None,
    )
    latest = SimpleNamespace(version_number=4, data={"English": {"content": "alpha"}})

    monkeypatch.setattr(rag_index_service, "get_embedding_profile", lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": None})
    monkeypatch.setattr(rag_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(rag_index_service, "_latest_version", lambda *_args, **_kwargs: latest)
    monkeypatch.setattr(rag_index_service, "compute_order_meta", lambda *_args, **_kwargs: rag_index_service.OrderMeta(type_group="story_object"))
    monkeypatch.setattr(rag_index_service, "_upsert_source", lambda *_args, **_kwargs: source)
    monkeypatch.setattr(rag_index_service, "extract_index_text", lambda *_args, **_kwargs: {"content": "alpha"})
    monkeypatch.setattr(rag_index_service, "chunk_fields", lambda _text_by_field: [{"field_path": "content", "chunk_index": 0, "text": "alpha"}])
    monkeypatch.setattr(
        rag_index_service,
        "compute_chunks_hash",
        lambda chunks: "|".join(str(chunk.get("text") or "") for chunk in chunks),
    )

    async def _raising_embed_many(**_kwargs):
        raise RuntimeError("embedding provider exploded")

    monkeypatch.setattr(rag_index_service, "embed_many", _raising_embed_many)

    try:
        asyncio.run(
            rag_index_service.index_object(
                db,
                user_id=uuid4(),
                project_id=uuid4(),
                object_type="character",
                object_id=uuid4(),
                provider_config={"api_key": "x"},
                force=False,
            )
        )
    except RuntimeError as exc:
        assert str(exc) == "embedding provider exploded"
    else:
        raise AssertionError("index_object should re-raise embedding failures")

    assert source.index_state == "error"
    assert db.commits == 2


class FakeNestedSession:
    def __init__(self) -> None:
        self.begin_nested_calls = 0

    @contextmanager
    def begin_nested(self):
        self.begin_nested_calls += 1
        yield


def test_object_patch_batch_flush_all_returns_per_key_status() -> None:
    session = FakeNestedSession()
    batch = ObjectPatchBatch()
    ok_id = uuid4()
    fail_id = uuid4()
    ok_key = batch.make_key("character", ok_id, "English")
    fail_key = batch.make_key("location", fail_id, "English")
    batch._states[ok_key] = ObjectPatchState(
        object_type="character",
        object_id=ok_id,
        project_id=uuid4(),
        language="English",
        create_new_version=True,
        user_id=uuid4(),
        data={"content": "ok"},
        touched_call_ids={"call-ok"},
    )
    batch._states[fail_key] = ObjectPatchState(
        object_type="location",
        object_id=fail_id,
        project_id=uuid4(),
        language="English",
        create_new_version=True,
        user_id=uuid4(),
        data={"content": "fail"},
        touched_call_ids={"call-fail"},
    )

    def _update_object(_db, *, object_id, **_kwargs):
        if object_id == fail_id:
            raise ValueError("flush exploded")
        return {"id": str(object_id)}

    object_service = SimpleNamespace(update_object=_update_object)
    results, key_to_call_ids = batch.flush_all(db=session, object_service=object_service, created_by=uuid4())

    assert results[ok_key].success is True
    assert results[fail_key].success is False
    assert results[fail_key].reason == "flush exploded"
    assert key_to_call_ids == {
        ok_key: {"call-ok"},
        fail_key: {"call-fail"},
    }
    assert session.begin_nested_calls == 2
    assert batch.has_pending is False


def test_thread_routes_marks_processing_tool_calls_failed_after_flush_errors() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    routes_text = (backend_root / "routes" / "thread_routes.py").read_text(encoding="utf-8")

    assert 'tc.status in {"applied", "processing"}' in routes_text

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from datetime import datetime
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
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    semantic_chunker = types.ModuleType("App.backend.services.semantic_chunker")
    semantic_chunker.merge_blocks_by_length = lambda blocks, **_kwargs: list(blocks)
    semantic_chunker.split_markdown_blocks = lambda text: [text] if text else []
    semantic_chunker.split_plaintext_blocks = lambda text: [text] if text else []
    sys.modules["App.backend.services.semantic_chunker"] = semantic_chunker

    semantic_embedding_service = types.ModuleType("App.backend.services.semantic_embedding_service")

    async def _embed_many(**_kwargs):
        return []

    semantic_embedding_service.embed_many = _embed_many
    sys.modules["App.backend.services.semantic_embedding_service"] = semantic_embedding_service

    object_access = types.ModuleType("App.backend.services.tool_engine.modules.object_access")
    object_access.extract_lang_data = lambda obj, _language: obj
    object_access.read_object = lambda *_args, **_kwargs: {}
    sys.modules["App.backend.services.tool_engine.modules.object_access"] = object_access


_install_import_stubs()

from App.backend.services import semantic_index_service
from App.backend.services.object_patch_batch import ObjectPatchBatch, ObjectPatchState


class FakeSemanticQuery:
    def __init__(self, session: "FakeSemanticSession", model: object) -> None:
        self._session = session
        self._model = model

    def filter(self, *_args: object, **_kwargs: object) -> "FakeSemanticQuery":
        return self

    def first(self):
        return None

    def distinct(self) -> "FakeSemanticQuery":
        return self

    def all(self) -> list[object]:
        return []

    def delete(self, **_kwargs: object) -> int:
        if self._model is semantic_index_service.SemanticChunk:
            self._session.deleted_chunk_rows += 1
        return 1


class FakeSemanticSession:
    def __init__(self) -> None:
        self.commits = 0
        self.deleted_chunk_rows = 0
        self.added: list[object] = []
        self.connection_checked_out = True

    def query(self, model: object) -> FakeSemanticQuery:
        return FakeSemanticQuery(self, model)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        return None

    def commit(self) -> None:
        self.commits += 1
        self.connection_checked_out = False


def _payload(hash_value: str) -> semantic_index_service.CurrentPayload:
    return semantic_index_service.CurrentPayload(
        has_indexable_text=True,
        chunks=[{"field_path": "content", "chunk_index": 0, "text": hash_value}],
        embedding_texts=[hash_value],
        current_hash=hash_value,
    )


def test_index_object_commits_before_embedding(monkeypatch) -> None:
    db = FakeSemanticSession()
    source = SimpleNamespace(
        id=uuid4(),
        content_hash=None,
        indexed_provider=None,
        indexed_model=None,
        indexed_at=None,
        last_attempted_hash=None,
        last_attempted_provider=None,
        last_attempted_model=None,
        last_error_at=None,
        last_error_message=None,
    )

    class FakeSemanticChunk:
        class _SourceIdColumn:
            def __eq__(self, _other: object) -> bool:
                return True

        source_id = _SourceIdColumn()

        def __init__(self, **kwargs: object) -> None:
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        semantic_index_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": None},
    )
    monkeypatch.setattr(semantic_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(semantic_index_service, "_latest_version", lambda *_args, **_kwargs: SimpleNamespace(data={}))
    monkeypatch.setattr(
        semantic_index_service,
        "_build_current_payload",
        lambda **_kwargs: _payload("alpha"),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "compute_order_meta",
        lambda *_args, **_kwargs: semantic_index_service.OrderMeta(type_group="story_object"),
    )
    monkeypatch.setattr(semantic_index_service, "_find_source", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(semantic_index_service, "_upsert_source", lambda *_args, **_kwargs: source)
    monkeypatch.setattr(semantic_index_service, "set_embedding_dimensions", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(semantic_index_service, "SemanticChunk", FakeSemanticChunk)

    async def _fake_embed_many(**_kwargs):
        assert db.commits == 1
        assert db.connection_checked_out is False
        return [[0.1, 0.2]]

    monkeypatch.setattr(semantic_index_service, "embed_many", _fake_embed_many)

    result = asyncio.run(
        semantic_index_service.index_object(
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
    assert source.content_hash == "alpha"
    assert source.indexed_provider == "openai"
    assert source.indexed_model == "embed"


def test_index_object_returns_stale_when_payload_changes_before_apply(monkeypatch) -> None:
    db = FakeSemanticSession()
    payloads = [_payload("alpha"), _payload("beta")]

    monkeypatch.setattr(
        semantic_index_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": None},
    )
    monkeypatch.setattr(semantic_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(semantic_index_service, "_latest_version", lambda *_args, **_kwargs: SimpleNamespace(data={}))
    monkeypatch.setattr(
        semantic_index_service,
        "_build_current_payload",
        lambda **_kwargs: payloads.pop(0),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "compute_order_meta",
        lambda *_args, **_kwargs: semantic_index_service.OrderMeta(type_group="story_object"),
    )
    monkeypatch.setattr(semantic_index_service, "_find_source", lambda *_args, **_kwargs: None)

    async def _fake_embed_many(**_kwargs):
        return [[0.1, 0.2]]

    monkeypatch.setattr(semantic_index_service, "embed_many", _fake_embed_many)

    result = asyncio.run(
        semantic_index_service.index_object(
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
    db = FakeSemanticSession()
    deleted = {"count": 0}
    embed_called = {"value": False}

    monkeypatch.setattr(
        semantic_index_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": None},
    )
    monkeypatch.setattr(semantic_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(semantic_index_service, "_latest_version", lambda *_args, **_kwargs: SimpleNamespace(data={}))
    monkeypatch.setattr(
        semantic_index_service,
        "_build_current_payload",
        lambda **_kwargs: semantic_index_service.CurrentPayload(
            has_indexable_text=False,
            chunks=[],
            embedding_texts=[],
            current_hash=None,
        ),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "_delete_source_rows",
        lambda *_args, **_kwargs: deleted.__setitem__("count", deleted["count"] + 1) or 1,
    )

    async def _fake_embed_many(**_kwargs):
        embed_called["value"] = True
        return [[0.1, 0.2]]

    monkeypatch.setattr(semantic_index_service, "embed_many", _fake_embed_many)

    result = asyncio.run(
        semantic_index_service.index_object(
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
    assert deleted["count"] == 1


def test_index_object_records_error_when_embedding_raises(monkeypatch) -> None:
    db = FakeSemanticSession()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        semantic_index_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": None},
    )
    monkeypatch.setattr(semantic_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(semantic_index_service, "_latest_version", lambda *_args, **_kwargs: SimpleNamespace(data={}))
    monkeypatch.setattr(
        semantic_index_service,
        "_build_current_payload",
        lambda **_kwargs: _payload("alpha"),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "compute_order_meta",
        lambda *_args, **_kwargs: semantic_index_service.OrderMeta(type_group="story_object"),
    )
    monkeypatch.setattr(semantic_index_service, "_find_source", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        semantic_index_service,
        "_record_index_error",
        lambda *_args, **kwargs: captured.update(kwargs),
    )

    async def _raising_embed_many(**_kwargs):
        raise RuntimeError("embedding provider exploded")

    monkeypatch.setattr(semantic_index_service, "embed_many", _raising_embed_many)

    try:
        asyncio.run(
            semantic_index_service.index_object(
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

    assert captured["message"] == "embedding provider exploded"
    assert captured["current_hash"] == "alpha"
    assert captured["preserve_searchable"] is True


def test_get_project_status_counts_project_refs_not_existing_rows(monkeypatch) -> None:
    user_id = uuid4()
    project_id = uuid4()
    ready_source = SimpleNamespace(
        id=uuid4(),
        object_type="character",
        object_id=uuid4(),
        content_hash="ready",
        indexed_provider="openai",
        indexed_model="embed",
        indexed_at=datetime(2026, 1, 2),
        last_attempted_hash=None,
        last_attempted_provider=None,
        last_attempted_model=None,
        last_error_at=None,
    )
    stale_source = SimpleNamespace(
        id=uuid4(),
        object_type="organization",
        object_id=uuid4(),
        content_hash="old",
        indexed_provider="openai",
        indexed_model="embed",
        indexed_at=datetime(2026, 1, 3),
        last_attempted_hash=None,
        last_attempted_provider=None,
        last_attempted_model=None,
        last_error_at=None,
    )
    error_source = SimpleNamespace(
        id=uuid4(),
        object_type="outline",
        object_id=uuid4(),
        content_hash=None,
        indexed_provider=None,
        indexed_model=None,
        indexed_at=None,
        last_attempted_hash="error",
        last_attempted_provider="openai",
        last_attempted_model="embed",
        last_error_at=datetime(2026, 1, 4),
    )

    refs = [
        ("character", ready_source.object_id),
        ("location", uuid4()),
        ("organization", stale_source.object_id),
        ("act", uuid4()),
        ("outline", error_source.object_id),
    ]
    payloads = {
        "character": _payload("ready"),
        "location": _payload("missing-row"),
        "organization": _payload("new"),
        "act": semantic_index_service.CurrentPayload(
            has_indexable_text=False,
            chunks=[],
            embedding_texts=[],
            current_hash=None,
        ),
        "outline": _payload("error"),
    }

    monkeypatch.setattr(semantic_index_service, "_project_object_refs", lambda *_args, **_kwargs: refs)
    monkeypatch.setattr(semantic_index_service, "get_main_language", lambda *_args, **_kwargs: "English")
    monkeypatch.setattr(
        semantic_index_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": 2},
    )
    monkeypatch.setattr(
        semantic_index_service,
        "_load_project_sources",
        lambda *_args, **_kwargs: {
            ("character", ready_source.object_id): ready_source,
            ("organization", stale_source.object_id): stale_source,
            ("outline", error_source.object_id): error_source,
        },
    )
    monkeypatch.setattr(
        semantic_index_service,
        "_load_chunked_source_ids",
        lambda *_args, **_kwargs: {ready_source.id, stale_source.id},
    )
    monkeypatch.setattr(semantic_index_service, "_latest_versions_for_refs", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        semantic_index_service,
        "_build_current_payload",
        lambda *, object_type, **_kwargs: payloads[object_type],
    )

    status = semantic_index_service.get_project_status(SimpleNamespace(), user_id=user_id, project_id=project_id)

    assert status["total_sources"] == 5
    assert status["ready_sources"] == 1
    assert status["stale_sources"] == 1
    assert status["unindexed_sources"] == 1
    assert status["missing_main_language_sources"] == 1
    assert status["error_sources"] == 1
    assert status["last_indexed_at"] == datetime(2026, 1, 3).isoformat()


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

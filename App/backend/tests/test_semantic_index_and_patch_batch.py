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

    markdown_it_pyrs = types.ModuleType("markdown_it_pyrs")

    class _FakeMarkdownIt:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def enable_many(self, *_args, **_kwargs):
            return self

        def parse(self, *_args, **_kwargs):
            return []

    markdown_it_pyrs.MarkdownIt = _FakeMarkdownIt
    sys.modules["markdown_it_pyrs"] = markdown_it_pyrs

    object_access = types.ModuleType("App.backend.services.tool_engine.modules.object_access")
    object_access.extract_lang_data = lambda obj, _language: obj
    object_access.read_object = lambda *_args, **_kwargs: {}
    sys.modules["App.backend.services.tool_engine.modules.object_access"] = object_access


_install_import_stubs()

from App.backend.services import semantic_index_service
import App.backend.services.object_patch_batch as object_patch_batch_module
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


class FakeProjectRefsQuery:
    def __init__(self, rows: list[object]) -> None:
        self._rows = list(rows)

    def join(self, *_args: object, **_kwargs: object) -> "FakeProjectRefsQuery":
        return self

    def filter(self, *_args: object, **_kwargs: object) -> "FakeProjectRefsQuery":
        return self

    def order_by(self, *_args: object, **_kwargs: object) -> "FakeProjectRefsQuery":
        return self

    def all(self) -> list[object]:
        return list(self._rows)


class FakeProjectRefsSession:
    def __init__(self, rows_by_model: dict[object, list[object]]) -> None:
        self._rows_by_model = rows_by_model

    def query(self, model: object) -> FakeProjectRefsQuery:
        return FakeProjectRefsQuery(self._rows_by_model.get(model, []))


def test_extract_index_text_timeline_objects_are_body_only() -> None:
    content_tree = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "Only this timeline body is indexed."}],
            }
        ],
    }
    version_data = {
        "English": {
            "name": "Do not index this title",
            "description": "Do not index this summary",
            "content": content_tree,
        }
    }

    assert semantic_index_service.extract_index_text("timeline_track", version_data, "English") == {
        "content": "Only this timeline body is indexed."
    }
    assert semantic_index_service.extract_index_text("timeline_event", version_data, "English") == {
        "content": "Only this timeline body is indexed."
    }


def test_project_object_refs_include_timeline_tracks_and_date_sorted_events() -> None:
    project_id = uuid4()
    story_id = uuid4()
    outline_id = uuid4()
    manuscript_id = uuid4()
    timeline_id = uuid4()
    track_id = uuid4()
    later_event_id = uuid4()
    earlier_event_id = uuid4()

    timeline = SimpleNamespace(
        id=timeline_id,
        project_id=project_id,
        calendar={"units": [{"name": "year", "label": "Year"}]},
    )
    track = SimpleNamespace(
        id=track_id,
        timeline_id=timeline_id,
        parent_id=None,
        position=0,
        created_at=datetime(2026, 1, 1),
    )
    later_event = SimpleNamespace(
        id=later_event_id,
        track_id=track_id,
        start_date={"year": 3},
        end_date=None,
        created_at=datetime(2026, 1, 3),
    )
    earlier_event = SimpleNamespace(
        id=earlier_event_id,
        track_id=track_id,
        start_date={"year": 1},
        end_date=None,
        created_at=datetime(2026, 1, 4),
    )
    db = FakeProjectRefsSession(
        {
            semantic_index_service.StoryEntity: [SimpleNamespace(id=story_id)],
            semantic_index_service.Outline: [SimpleNamespace(id=outline_id)],
            semantic_index_service.Manuscript: [SimpleNamespace(id=manuscript_id, chapter_id=outline_id)],
            semantic_index_service.Timeline: [timeline],
            semantic_index_service.TimelineTrack: [track],
            semantic_index_service.TimelineEvent: [later_event, earlier_event],
        }
    )

    assert semantic_index_service._project_object_refs(db, project_id=project_id) == [
        ("story_entity", story_id),
        ("outline", outline_id),
        ("manuscript", manuscript_id),
        ("timeline_track", track_id),
        ("timeline_event", earlier_event_id),
        ("timeline_event", later_event_id),
    ]


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
    monkeypatch.setattr(
        semantic_index_service,
        "_latest_version_with_language",
        lambda *_args, **_kwargs: (SimpleNamespace(id=uuid4()), SimpleNamespace(data={})),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "_build_current_payload",
        lambda **_kwargs: _payload("alpha"),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "compute_order_meta",
        lambda *_args, **_kwargs: semantic_index_service.OrderMeta(type_group="story_entity"),
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
    monkeypatch.setattr(
        semantic_index_service,
        "_latest_version_with_language",
        lambda *_args, **_kwargs: (SimpleNamespace(id=uuid4()), SimpleNamespace(data={})),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "_build_current_payload",
        lambda **_kwargs: payloads.pop(0),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "compute_order_meta",
        lambda *_args, **_kwargs: semantic_index_service.OrderMeta(type_group="story_entity"),
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
    monkeypatch.setattr(
        semantic_index_service,
        "_latest_version_with_language",
        lambda *_args, **_kwargs: (SimpleNamespace(id=uuid4()), SimpleNamespace(data={})),
    )
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
    monkeypatch.setattr(
        semantic_index_service,
        "_latest_version_with_language",
        lambda *_args, **_kwargs: (SimpleNamespace(id=uuid4()), SimpleNamespace(data={})),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "_build_current_payload",
        lambda **_kwargs: _payload("alpha"),
    )
    monkeypatch.setattr(
        semantic_index_service,
        "compute_order_meta",
        lambda *_args, **_kwargs: semantic_index_service.OrderMeta(type_group="story_entity"),
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


def test_reindex_project_indexes_timeline_refs_and_preserves_existing_timeline_sources(monkeypatch) -> None:
    user_id = uuid4()
    project_id = uuid4()
    track_id = uuid4()
    event_id = uuid4()
    removed_id = uuid4()
    refs = [("timeline_track", track_id), ("timeline_event", event_id)]
    existing_timeline_source = SimpleNamespace(object_type="timeline_track", object_id=track_id)
    removed_source = SimpleNamespace(object_type="story_entity", object_id=removed_id)

    class FakeSemanticSourceQuery:
        def filter(self, *_args: object, **_kwargs: object) -> "FakeSemanticSourceQuery":
            return self

        def all(self) -> list[object]:
            return [existing_timeline_source, removed_source]

    class FakeReindexSession:
        def __init__(self) -> None:
            self.deleted: list[object] = []
            self.flush_calls = 0

        def query(self, model: object) -> FakeSemanticSourceQuery:
            assert model is semantic_index_service.SemanticSource
            return FakeSemanticSourceQuery()

        def delete(self, source: object) -> None:
            self.deleted.append(source)

        def flush(self) -> None:
            self.flush_calls += 1

    indexed_refs: list[tuple[str, object]] = []

    async def _fake_index_object(_db, *, object_type, object_id, **_kwargs):
        indexed_refs.append((object_type, object_id))
        return {"rebuilt": True, "skipped": False, "missing_main_language": False}

    monkeypatch.setattr(
        semantic_index_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": 2},
    )
    monkeypatch.setattr(semantic_index_service, "_project_object_refs", lambda *_args, **_kwargs: refs)
    monkeypatch.setattr(semantic_index_service, "index_object", _fake_index_object)

    db = FakeReindexSession()
    summary = asyncio.run(
        semantic_index_service.reindex_project(
            db,
            user_id=user_id,
            project_id=project_id,
            provider_config={"api_key": "x"},
        )
    )

    assert indexed_refs == refs
    assert db.deleted == [removed_source]
    assert db.flush_calls == 1
    assert summary == {
        "indexed_sources": 2,
        "rebuilt_sources": 2,
        "skipped_sources": 0,
        "missing_main_language_sources": 0,
    }


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


def test_object_patch_batch_reads_and_writes_markdown_for_rich_objects(monkeypatch) -> None:
    session = FakeNestedSession()
    batch = ObjectPatchBatch()
    object_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}

    def _fake_read_object(*_args, **kwargs):
        captured["read_rich_text_format"] = kwargs.get("rich_text_format")
        return {
            "name": "Chapter 1",
            "description": "desc",
            "content": "**Timeline**: Months 44-46 - daily life as the community rebuilds.",
        }

    monkeypatch.setattr(object_patch_batch_module, "read_object", _fake_read_object)

    result = batch.apply_patch(
        db=session,
        project_id=project_id,
        object_type="outline",
        object_id=object_id,
        language="English",
        field="content",
        old_text="**Timeline**: Months 44-46 - daily life as the community rebuilds.",
        new_text="**Timeline**: Months 44-46 - daily routines as the community rebuilds.",
        call_id="call-1",
        create_new_version=True,
        user_id=user_id,
    )

    assert result == {"success": True}
    assert captured["read_rich_text_format"] == "markdown"

    def _update_object(_db, **kwargs):
        captured["write_rich_text_format"] = kwargs.get("rich_text_format")
        captured["written_data"] = kwargs.get("data")
        return {"id": str(object_id)}

    object_service = SimpleNamespace(update_object=_update_object)
    results, _ = batch.flush_all(db=session, object_service=object_service, created_by=user_id)

    key = batch.make_key("outline", object_id, "English")
    assert results[key].success is True
    assert captured["write_rich_text_format"] == "markdown"
    assert "daily routines as the community rebuilds" in captured["written_data"]["content"]


def test_object_patch_batch_preserves_patch_mismatch_reason(monkeypatch) -> None:
    session = FakeNestedSession()
    batch = ObjectPatchBatch()
    object_id = uuid4()
    project_id = uuid4()

    def _fake_read_object(*_args, **_kwargs):
        return {
            "content": "제단 위에는 검은 봉인석이 놓여 있었다.",
        }

    monkeypatch.setattr(object_patch_batch_module, "read_object", _fake_read_object)

    result = batch.apply_patch(
        db=session,
        project_id=project_id,
        object_type="outline",
        object_id=object_id,
        language="Korean",
        field="content",
        old_text="제단 위에는 붉은 봉인석이 놓여 있었다.",
        new_text="제단 위에는 푸른 봉인석이 놓여 있었다.",
        call_id="call-1",
        create_new_version=True,
        user_id=uuid4(),
    )

    assert result["success"] is False
    assert result["reason"] == (
        'PATCH_NOT_FOUND\n'
        'expected="제단 위에는 붉은 봉인석이 놓여 있었다."\n'
        'actual="제단 위에는 검은 봉인석이 놓여 있었다."'
    )


def test_thread_routes_marks_processing_tool_calls_failed_after_flush_errors() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    routes_text = (backend_root / "routes" / "thread_routes.py").read_text(encoding="utf-8")

    assert 'failed_row.status in {"processing", "working"}' in routes_text

from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    semantic_models = types.ModuleType("App.backend.models.semantic_models")
    semantic_models.SemanticSource = type("SemanticSource", (), {})
    sys.modules["App.backend.models.semantic_models"] = semantic_models

    translation_models = types.ModuleType("App.backend.models.translation_models")
    translation_models.ObjectVersion = type("ObjectVersion", (), {})
    translation_models.ObjectVersionLanguage = type("ObjectVersionLanguage", (), {})
    sys.modules["App.backend.models.translation_models"] = translation_models

    embedding_config_service = types.ModuleType("App.backend.services.embedding_config_service")
    embedding_config_service.get_embedding_profile = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.embedding_config_service"] = embedding_config_service

    semantic_embedding_service = types.ModuleType("App.backend.services.semantic_embedding_service")

    async def _embed_many(**_kwargs):
        return []

    semantic_embedding_service.embed_many = _embed_many
    sys.modules["App.backend.services.semantic_embedding_service"] = semantic_embedding_service

    semantic_index_service = types.ModuleType("App.backend.services.semantic_index_service")
    semantic_index_service.get_main_language = lambda *_args, **_kwargs: "English"
    sys.modules["App.backend.services.semantic_index_service"] = semantic_index_service


_install_import_stubs()

from App.backend.services import semantic_search_service


class FakeResult:
    def __init__(self, first_row: object | None) -> None:
        self._first_row = first_row

    def first(self):
        return self._first_row


class FakeDB:
    def __init__(self, first_rows: list[object | None]) -> None:
        self._first_rows = list(first_rows)
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, stmt: object, params: dict[str, object]) -> FakeResult:
        self.calls.append((str(stmt), dict(params)))
        if not self._first_rows:
            raise AssertionError("Unexpected execute call")
        return FakeResult(self._first_rows.pop(0))


class RegexFakeResult:
    def __init__(self, *, first_row: object | None = None, rows: list[object] | None = None) -> None:
        self._first_row = first_row
        self._rows = list(rows or [])

    def first(self):
        return self._first_row

    def fetchall(self):
        return list(self._rows)


class RegexFakeDB:
    def __init__(self, results: list[object]) -> None:
        self._results = list(results)
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, stmt: object, params: dict[str, object]):
        self.calls.append((str(stmt), dict(params)))
        if not self._results:
            raise AssertionError("Unexpected execute call")
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def test_search_project_returns_empty_without_embedding_when_index_is_empty(monkeypatch) -> None:
    db = FakeDB([None])
    user_id = uuid4()
    project_id = uuid4()
    embed_called = {"value": False}

    monkeypatch.setattr(
        semantic_search_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed"},
    )
    monkeypatch.setattr(semantic_search_service, "get_main_language", lambda *_args, **_kwargs: "English")

    async def _fake_embed_many(**_kwargs):
        embed_called["value"] = True
        return [[0.1, 0.2]]

    monkeypatch.setattr(semantic_search_service, "embed_many", _fake_embed_many)

    result = asyncio.run(
        semantic_search_service.search_project(
            db,
            user_id=user_id,
            project_id=project_id,
            queries=["find hero"],
            provider_config={"api_key": "x"},
        )
    )

    assert result == []
    assert embed_called["value"] is False
    assert len(db.calls) == 1
    statement, params = db.calls[0]
    assert "FROM semantic_chunks c" in statement
    assert "JOIN semantic_sources s ON s.id = c.source_id" in statement
    assert params == {
        "user_id": user_id,
        "project_id": project_id,
        "language": "English",
        "provider": "openai",
        "model": "embed",
    }


def test_search_project_calls_embedding_when_matching_index_exists(monkeypatch) -> None:
    db = FakeDB([object()])
    user_id = uuid4()
    project_id = uuid4()
    embed_calls: list[dict[str, object]] = []
    vector_calls: list[dict[str, object]] = []
    expected = [{"chunk_id": "chunk-1"}]

    monkeypatch.setattr(
        semantic_search_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed"},
    )
    monkeypatch.setattr(semantic_search_service, "get_main_language", lambda *_args, **_kwargs: "English")

    async def _fake_embed_many(**kwargs):
        embed_calls.append(kwargs)
        return [[0.1, 0.2]]

    monkeypatch.setattr(semantic_search_service, "embed_many", _fake_embed_many)

    def _fake_run_vector_queries(**kwargs):
        vector_calls.append(kwargs)
        return expected

    monkeypatch.setattr(semantic_search_service, "_run_vector_queries", _fake_run_vector_queries)

    async def _fake_to_thread(fn, /, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(semantic_search_service.asyncio, "to_thread", _fake_to_thread)

    result = asyncio.run(
        semantic_search_service.search_project(
            db,
            user_id=user_id,
            project_id=project_id,
            queries=["find hero"],
            provider_config={"api_key": "x"},
            top_k_per_query=7,
            neighbor_window=2,
            max_primary_items=5,
            max_total_items=9,
        )
    )

    assert result == expected
    assert len(embed_calls) == 1
    assert embed_calls[0] == {
        "provider": "openai",
        "model": "embed",
        "inputs": ["find hero"],
        "config": {"api_key": "x"},
        "dimensions": None,
        "purpose": "query",
    }
    assert len(vector_calls) == 1
    assert vector_calls[0]["query_vectors"] == [[0.1, 0.2]]
    assert vector_calls[0]["user_id"] == user_id
    assert vector_calls[0]["project_id"] == project_id
    assert vector_calls[0]["language"] == "English"
    assert vector_calls[0]["provider"] == "openai"
    assert vector_calls[0]["model"] == "embed"
    assert vector_calls[0]["top_k_per_query"] == 7
    assert vector_calls[0]["neighbor_window"] == 2
    assert vector_calls[0]["max_primary_items"] == 5
    assert vector_calls[0]["max_total_items"] == 9


def test_search_project_by_regex_uses_case_insensitive_operator_by_default(monkeypatch) -> None:
    row = SimpleNamespace(
        chunk_id=uuid4(),
        source_id=uuid4(),
        object_type="story_entity",
        object_id=uuid4(),
        type_group="story_entity",
        story_entity_kind="character",
        story_entity_order=1,
        outline_order=None,
        act_order=None,
        chapter_order=None,
        chapter_id=None,
        field_path="content",
        chunk_index=0,
        text="Hero wound mentioned here.",
    )
    db = RegexFakeDB([
        RegexFakeResult(first_row=SimpleNamespace(total=1)),
        RegexFakeResult(rows=[row]),
    ])

    monkeypatch.setattr(
        semantic_search_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed"},
    )
    monkeypatch.setattr(semantic_search_service, "get_main_language", lambda *_args, **_kwargs: "English")

    result = semantic_search_service.search_project_by_regex(
        db,
        user_id=uuid4(),
        project_id=uuid4(),
        pattern="hero.*wound",
    )

    assert result["total"] == 1
    assert len(result["results"]) == 1
    count_stmt, count_params = db.calls[0]
    assert "c.text ~* :pattern" in count_stmt
    assert count_params["pattern"] == "hero.*wound"


def test_search_project_by_regex_uses_case_sensitive_operator_when_enabled(monkeypatch) -> None:
    db = RegexFakeDB([RegexFakeResult(first_row=SimpleNamespace(total=0))])

    monkeypatch.setattr(
        semantic_search_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed"},
    )
    monkeypatch.setattr(semantic_search_service, "get_main_language", lambda *_args, **_kwargs: "English")

    result = semantic_search_service.search_project_by_regex(
        db,
        user_id=uuid4(),
        project_id=uuid4(),
        pattern="Hero.*Wound",
        case_sensitive=True,
    )

    assert result == {"total": 0, "results": []}
    assert "c.text ~ :pattern" in db.calls[0][0]
    assert "~* :pattern" not in db.calls[0][0]


def test_search_project_by_regex_converts_invalid_regex_errors(monkeypatch) -> None:
    db = RegexFakeDB([
        DBAPIError("SELECT 1", {"pattern": "("}, Exception("invalid regular expression: parentheses not balanced")),
    ])

    monkeypatch.setattr(
        semantic_search_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed"},
    )
    monkeypatch.setattr(semantic_search_service, "get_main_language", lambda *_args, **_kwargs: "English")

    try:
        semantic_search_service.search_project_by_regex(
            db,
            user_id=uuid4(),
            project_id=uuid4(),
            pattern="(",
        )
    except ValueError as exc:
        assert str(exc) == "Invalid regex pattern"
    else:
        raise AssertionError("Expected ValueError for invalid regex")

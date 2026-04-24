from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_import_stubs() -> None:
    db_models = types.ModuleType("App.backend.models.db_models")
    db_models.RunMessageModel = type("RunMessageModel", (), {})
    sys.modules["App.backend.models.db_models"] = db_models

    memory_models = types.ModuleType("App.backend.models.memory_models")
    memory_models.MessageMemorySummary = type("MessageMemorySummary", (), {})
    memory_models.MessageSemanticSource = type("MessageSemanticSource", (), {})
    sys.modules["App.backend.models.memory_models"] = memory_models

    credential_service = types.ModuleType("App.backend.services.credential_service")
    credential_service.credential_service = SimpleNamespace(get_provider_config=lambda *_args, **_kwargs: {})
    sys.modules["App.backend.services.credential_service"] = credential_service

    embedding_config_service = types.ModuleType("App.backend.services.embedding_config_service")
    embedding_config_service.get_embedding_profile = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.embedding_config_service"] = embedding_config_service

    memory_pkg = types.ModuleType("App.backend.services.memory")
    memory_pkg.__path__ = [str(ROOT / "App" / "backend" / "services" / "memory")]
    sys.modules["App.backend.services.memory"] = memory_pkg

    state = types.ModuleType("App.backend.services.memory.state")
    state.latest_summary = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.memory.state"] = state

    semantic_embedding_service = types.ModuleType("App.backend.services.semantic_embedding_service")

    async def _embed_many(**_kwargs):
        return []

    semantic_embedding_service.embed_many = _embed_many
    sys.modules["App.backend.services.semantic_embedding_service"] = semantic_embedding_service

    settings_service = types.ModuleType("App.backend.services.settings_service")
    settings_service.settings_service = SimpleNamespace()
    sys.modules["App.backend.services.settings_service"] = settings_service


_install_import_stubs()

from App.backend.services import memory_service


class FakeResult:
    def __init__(self, *, first_row: object | None = None, rows: list[object] | None = None) -> None:
        self._first_row = first_row
        self._rows = list(rows or [])

    def first(self):
        return self._first_row

    def fetchall(self):
        return list(self._rows)


class FakeDB:
    def __init__(self, results: list[FakeResult]) -> None:
        self._results = list(results)
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, stmt: object, params: dict[str, object]) -> FakeResult:
        self.calls.append((str(stmt), dict(params)))
        if not self._results:
            raise AssertionError("Unexpected execute call")
        return self._results.pop(0)


def test_search_thread_memory_returns_empty_without_embedding_when_no_ready_chunks(monkeypatch) -> None:
    db = FakeDB([FakeResult(first_row=None)])
    user_id = uuid4()
    project_id = uuid4()
    thread_id = uuid4()

    monkeypatch.setattr(
        memory_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed"},
    )

    def _unexpected_provider_config(*_args, **_kwargs):
        raise AssertionError("provider config should not be loaded without ready memory chunks")

    async def _unexpected_embed_many(**_kwargs):
        raise AssertionError("embed_many should not be called without ready memory chunks")

    monkeypatch.setattr(
        memory_service,
        "credential_service",
        SimpleNamespace(get_provider_config=_unexpected_provider_config),
    )
    monkeypatch.setattr(memory_service, "embed_many", _unexpected_embed_many)

    result = asyncio.run(
        memory_service.search_thread_memory(
            db,
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            language="English",
            queries=["find prior scene"],
        )
    )

    assert result == []
    assert len(db.calls) == 1
    statement, params = db.calls[0]
    assert "FROM message_semantic_chunks c" in statement
    assert "JOIN message_semantic_sources s ON s.id = c.source_id" in statement
    assert "s.index_state = 'ready'" in statement
    assert params == {
        "user_id": user_id,
        "project_id": project_id,
        "thread_id": thread_id,
        "language": "English",
    }


def test_search_thread_memory_calls_embedding_when_ready_chunks_exist(monkeypatch) -> None:
    db = FakeDB([
        FakeResult(first_row=object()),
        FakeResult(rows=[]),
    ])
    user_id = uuid4()
    project_id = uuid4()
    thread_id = uuid4()
    embed_calls: list[dict[str, object]] = []

    monkeypatch.setattr(
        memory_service,
        "get_embedding_profile",
        lambda *_args, **_kwargs: {"provider": "openai", "model": "embed", "dimensions": 1536},
    )
    monkeypatch.setattr(
        memory_service,
        "settings_service",
        SimpleNamespace(
            get_memory_settings=lambda *_args, **_kwargs: SimpleNamespace(
                retrieval=SimpleNamespace(
                    top_k_per_query=7,
                    neighbor_window=0,
                    max_primary_items=5,
                    max_total_items=9,
                )
            )
        ),
    )
    monkeypatch.setattr(
        memory_service,
        "credential_service",
        SimpleNamespace(get_provider_config=lambda *_args, **_kwargs: {"api_key": "x"}),
    )

    async def _fake_embed_many(**kwargs):
        embed_calls.append(kwargs)
        return [[0.1, 0.2]]

    monkeypatch.setattr(memory_service, "embed_many", _fake_embed_many)

    result = asyncio.run(
        memory_service.search_thread_memory(
            db,
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            language="English",
            queries=["find prior scene"],
        )
    )

    assert result == []
    assert len(db.calls) == 2
    assert len(embed_calls) == 1
    assert embed_calls[0] == {
        "provider": "openai",
        "model": "embed",
        "inputs": ["find prior scene"],
        "config": {"api_key": "x"},
        "dimensions": 1536,
        "purpose": "query",
    }
    vector_statement, vector_params = db.calls[1]
    assert "ORDER BY c.embedding <-> (:qv)::vector" in vector_statement
    assert vector_params["qv"] == "[0.1,0.2]"
    assert vector_params["user_id"] == user_id
    assert vector_params["project_id"] == project_id
    assert vector_params["thread_id"] == thread_id
    assert vector_params["language"] == "English"
    assert vector_params["k"] == 7


def test_search_thread_memory_returns_empty_without_queries(monkeypatch) -> None:
    db = FakeDB([])

    def _unexpected_profile(*_args, **_kwargs):
        raise AssertionError("profile should not be loaded without queries")

    monkeypatch.setattr(memory_service, "get_embedding_profile", _unexpected_profile)

    result = asyncio.run(
        memory_service.search_thread_memory(
            db,
            user_id=uuid4(),
            project_id=uuid4(),
            thread_id=uuid4(),
            language="English",
            queries=[],
        )
    )

    assert result == []
    assert db.calls == []


def test_search_thread_memory_returns_empty_without_profile(monkeypatch) -> None:
    db = FakeDB([])
    monkeypatch.setattr(memory_service, "get_embedding_profile", lambda *_args, **_kwargs: None)

    async def _unexpected_embed_many(**_kwargs):
        raise AssertionError("embed_many should not be called without memory profile")

    monkeypatch.setattr(memory_service, "embed_many", _unexpected_embed_many)

    result = asyncio.run(
        memory_service.search_thread_memory(
            db,
            user_id=uuid4(),
            project_id=uuid4(),
            thread_id=uuid4(),
            language="English",
            queries=["find prior scene"],
        )
    )

    assert result == []
    assert db.calls == []

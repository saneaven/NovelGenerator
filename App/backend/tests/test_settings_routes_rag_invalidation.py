from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace
import types
from uuid import uuid4

fake_auth = types.ModuleType("App.backend.auth")
fake_auth.get_current_user = lambda: None
sys.modules["App.backend.auth"] = fake_auth

fake_database = types.ModuleType("App.backend.database")
fake_database.get_db = lambda: None
sys.modules["App.backend.database"] = fake_database

fake_memory_service = types.ModuleType("App.backend.services.memory_service")
fake_memory_service.wipe_memory_index = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.memory_service"] = fake_memory_service

fake_rag_index_service = types.ModuleType("App.backend.services.rag_index_service")
fake_rag_index_service.wipe_user_index = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.rag_index_service"] = fake_rag_index_service

from App.backend.routes import settings_routes
from App.backend.schemas.settings import EmbeddingConfigs, EmbeddingProfileConfig, UserSettingsUpdate


class FakeQuery:
    def __init__(self, settings: object) -> None:
        self._settings = settings

    def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def first(self):
        return self._settings


class FakeDB:
    def __init__(self, settings: object) -> None:
        self._settings = settings
        self.commits = 0
        self.refreshed: list[object] = []

    def query(self, _model: object) -> FakeQuery:
        return FakeQuery(self._settings)

    def commit(self) -> None:
        self.commits += 1

    def refresh(self, obj: object) -> None:
        self.refreshed.append(obj)


def test_update_user_settings_wipes_rag_index_on_main_language_change(monkeypatch) -> None:
    user_id = uuid4()
    settings = SimpleNamespace(
        user_id=user_id,
        demo_mode_enabled=False,
        main_language="English",
        embedding_configs={
            "ragSearch": {"provider": "openai", "model": "text-embedding-3-small", "dimensions": 1536},
            "agentMemory": {"provider": "openai", "model": "", "dimensions": None},
        },
    )
    db = FakeDB(settings)
    wiped: list[object] = []

    monkeypatch.setattr(settings_routes, "wipe_user_index", lambda *_args, **kwargs: wiped.append(kwargs["user_id"]))
    monkeypatch.setattr(settings_routes, "wipe_memory_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(settings_routes, "_build_settings_response", lambda current: current)

    result = asyncio.run(
        settings_routes.update_user_settings(
            UserSettingsUpdate(mainLanguage="Korean"),
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert result.main_language == "Korean"
    assert wiped == [user_id]
    assert db.commits == 1
    assert db.refreshed == [settings]


def test_update_user_settings_wipes_rag_index_once_on_rag_model_change(monkeypatch) -> None:
    user_id = uuid4()
    settings = SimpleNamespace(
        user_id=user_id,
        demo_mode_enabled=False,
        main_language="English",
        embedding_configs={
            "ragSearch": {"provider": "openai", "model": "old-model", "dimensions": 1536},
            "agentMemory": {"provider": "openai", "model": "", "dimensions": None},
        },
    )
    db = FakeDB(settings)
    wiped: list[object] = []

    monkeypatch.setattr(settings_routes, "wipe_user_index", lambda *_args, **kwargs: wiped.append(kwargs["user_id"]))
    monkeypatch.setattr(settings_routes, "wipe_memory_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(settings_routes, "_build_settings_response", lambda current: current)

    update = UserSettingsUpdate(
        embeddingConfigs=EmbeddingConfigs(
            ragSearch=EmbeddingProfileConfig(provider="openai", model="new-model", dimensions=3072),
            agentMemory=EmbeddingProfileConfig(provider="openai", model="", dimensions=None),
        )
    )
    result = asyncio.run(
        settings_routes.update_user_settings(
            update,
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert wiped == [user_id]
    assert result.embedding_configs["ragSearch"]["model"] == "new-model"
    assert result.embedding_configs["ragSearch"]["dimensions"] is None

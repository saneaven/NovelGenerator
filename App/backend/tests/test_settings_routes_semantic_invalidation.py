from __future__ import annotations

import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace
import types
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import declarative_base

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

fake_auth = types.ModuleType("App.backend.auth")
fake_auth.get_current_user = lambda: None
sys.modules["App.backend.auth"] = fake_auth

fake_database = types.ModuleType("App.backend.database")
fake_database.Base = declarative_base()
fake_database.get_db = lambda: None
sys.modules["App.backend.database"] = fake_database
sys.modules["database"] = fake_database

fake_memory_service = types.ModuleType("App.backend.services.memory_service")
fake_memory_service.wipe_memory_index = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.memory_service"] = fake_memory_service

fake_semantic_index_service = types.ModuleType("App.backend.services.semantic_index_service")
fake_semantic_index_service.wipe_user_semantic_index = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.semantic_index_service"] = fake_semantic_index_service

from App.backend.routes import settings_routes
from App.backend.schemas.settings import UserSettingsUpdate

sys.modules.pop("App.backend.services.memory_service", None)
sys.modules.pop("App.backend.services.semantic_index_service", None)


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


def test_update_user_settings_wipes_semantic_index_on_main_language_change(monkeypatch) -> None:
    user_id = uuid4()
    settings = SimpleNamespace(
        user_id=user_id,
        demo_mode_enabled=False,
        main_language="English",
        search_memory_settings={
            "enabled": True,
            "general": {
                "embedding": {"provider": "openai", "model": "text-embedding-3-small", "dimensions": 1536},
                "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
                "regexPageSize": 20,
            },
            "overrides": {
                "memory": {
                    "embedding": {"provider": "openai", "model": "text-embedding-3-small", "dimensions": 1536},
                    "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
                }
            },
        },
    )
    db = FakeDB(settings)
    wiped: list[object] = []

    monkeypatch.setattr(settings_routes, "wipe_user_semantic_index", lambda *_args, **kwargs: wiped.append(kwargs["user_id"]))
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


def test_update_user_settings_wipes_semantic_index_once_on_search_model_change(monkeypatch) -> None:
    user_id = uuid4()
    settings = SimpleNamespace(
        user_id=user_id,
        demo_mode_enabled=False,
        main_language="English",
        search_memory_settings={
            "enabled": True,
            "general": {
                "embedding": {"provider": "openai", "model": "old-model", "dimensions": 1536},
                "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
                "regexPageSize": 20,
            },
            "overrides": {
                "memory": {
                    "embedding": {"provider": "openai", "model": "memory-model", "dimensions": 1536},
                    "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
                }
            },
        },
    )
    db = FakeDB(settings)
    wiped: list[object] = []

    monkeypatch.setattr(settings_routes, "wipe_user_semantic_index", lambda *_args, **kwargs: wiped.append(kwargs["user_id"]))
    monkeypatch.setattr(settings_routes, "wipe_memory_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(settings_routes, "_build_settings_response", lambda current: current)

    update = UserSettingsUpdate(
        searchMemorySettings={
            "enabled": True,
            "general": {
                "embedding": {"provider": "openai", "model": "new-model", "dimensions": 3072},
                "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
                "regexPageSize": 20,
            },
            "overrides": {
                "memory": {
                    "embedding": {"provider": "openai", "model": "memory-model", "dimensions": 1536},
                    "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
                }
            },
        },
    )
    result = asyncio.run(
        settings_routes.update_user_settings(
            update,
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert wiped == [user_id]
    assert result.search_memory_settings["general"]["embedding"]["model"] == "new-model"
    assert result.search_memory_settings["general"]["embedding"]["dimensions"] is None


def test_update_user_settings_accepts_disabled_incomplete_search_memory_settings(monkeypatch) -> None:
    user_id = uuid4()
    settings = SimpleNamespace(
        user_id=user_id,
        demo_mode_enabled=False,
        main_language="English",
        search_memory_settings={
            "enabled": False,
            "general": {
                "embedding": {"provider": "openai", "model": "", "dimensions": None},
                "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
                "regexPageSize": 20,
            },
            "overrides": {},
        },
    )
    db = FakeDB(settings)

    monkeypatch.setattr(settings_routes, "wipe_user_semantic_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(settings_routes, "wipe_memory_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(settings_routes, "_build_settings_response", lambda current: current)

    result = asyncio.run(
        settings_routes.update_user_settings(
            UserSettingsUpdate(
                searchMemorySettings={
                    "enabled": False,
                    "general": {
                        "embedding": {"provider": "openai", "model": "", "dimensions": None},
                        "retrieval": {
                            "topKPerQuery": 4,
                            "neighborWindow": 1,
                            "maxPrimaryItems": 5,
                            "maxTotalItems": 8,
                        },
                        "regexPageSize": 12,
                    },
                    "overrides": {},
                }
            ),
            current_user=SimpleNamespace(id=user_id),
            db=db,
        )
    )

    assert result.search_memory_settings["enabled"] is False
    assert result.search_memory_settings["general"]["embedding"]["model"] == ""
    assert result.search_memory_settings["general"]["regexPageSize"] == 12


def test_update_user_settings_rejects_enabled_search_memory_without_effective_model(monkeypatch) -> None:
    user_id = uuid4()
    settings = SimpleNamespace(
        user_id=user_id,
        demo_mode_enabled=False,
        main_language="English",
        search_memory_settings={
            "enabled": False,
            "general": {
                "embedding": {"provider": "openai", "model": "", "dimensions": None},
                "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
                "regexPageSize": 20,
            },
            "overrides": {},
        },
    )
    db = FakeDB(settings)

    monkeypatch.setattr(settings_routes, "wipe_user_semantic_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(settings_routes, "wipe_memory_index", lambda *_args, **_kwargs: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            settings_routes.update_user_settings(
                UserSettingsUpdate(
                    searchMemorySettings={
                        "enabled": True,
                        "general": {
                            "embedding": {"provider": "openai", "model": "", "dimensions": None},
                            "retrieval": {
                                "topKPerQuery": 20,
                                "neighborWindow": 0,
                                "maxPrimaryItems": 20,
                                "maxTotalItems": 60,
                            },
                            "regexPageSize": 20,
                        },
                        "overrides": {
                            "memory": {
                                "embedding": {"provider": "openai", "model": "memory-model", "dimensions": None},
                                "retrieval": {
                                    "topKPerQuery": 20,
                                    "neighborWindow": 0,
                                    "maxPrimaryItems": 20,
                                    "maxTotalItems": 60,
                                },
                            }
                        },
                    }
                ),
                current_user=SimpleNamespace(id=user_id),
                db=db,
            )
        )

    assert exc_info.value.status_code == 422
    assert "Search embedding provider/model is required" in str(exc_info.value.detail)

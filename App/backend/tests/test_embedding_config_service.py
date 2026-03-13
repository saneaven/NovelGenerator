from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import types
from uuid import uuid4

from sqlalchemy.orm import declarative_base

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

fake_database = types.ModuleType("App.backend.database")
fake_database.Base = declarative_base()
sys.modules["App.backend.database"] = fake_database
sys.modules["database"] = fake_database

from App.backend.services.embedding_config_service import set_embedding_dimensions
from App.backend.services.search_memory_settings import (
    make_initial_search_memory_settings,
    make_search_override_seed,
)


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

    def query(self, _model: object) -> FakeQuery:
        return FakeQuery(self._settings)


def test_set_embedding_dimensions_uses_general_config_when_search_override_is_null() -> None:
    settings = SimpleNamespace(
        user_id=uuid4(),
        search_memory_settings=make_initial_search_memory_settings(),
    )
    db = FakeDB(settings)

    set_embedding_dimensions(db, user_id=settings.user_id, feature="search", dimensions=1536)

    assert settings.search_memory_settings["general"]["embedding"]["dimensions"] == 1536
    assert settings.search_memory_settings["overrides"]["search"] is None
    assert settings.search_memory_settings["overrides"]["memory"] is None


def test_set_embedding_dimensions_uses_search_override_when_present() -> None:
    settings = SimpleNamespace(
        user_id=uuid4(),
        search_memory_settings=make_initial_search_memory_settings(),
    )
    settings.search_memory_settings["overrides"]["search"] = make_search_override_seed(settings.search_memory_settings)
    db = FakeDB(settings)

    set_embedding_dimensions(db, user_id=settings.user_id, feature="search", dimensions=1536)

    assert settings.search_memory_settings["general"]["embedding"]["dimensions"] is None
    assert settings.search_memory_settings["overrides"]["search"]["embedding"]["dimensions"] == 1536

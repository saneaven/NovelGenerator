from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    fake_auth = types.ModuleType("App.backend.auth")
    fake_auth.get_password_hash = lambda value: f"hashed:{value}"
    fake_auth.verify_password = lambda *_args, **_kwargs: True
    fake_auth.create_access_token = lambda *_args, **_kwargs: "token"
    fake_auth.get_current_user = lambda: None
    sys.modules["App.backend.auth"] = fake_auth


_install_import_stubs()

import App.backend.routes.auth_routes as auth_routes
import App.backend.services.preset_service as preset_service_module
from App.backend.models.db_models import PromptFragment, PromptPreset, PromptScenarioVersion, PromptVariable, SubAgentDefinitionModel
from App.backend.schemas.auth import UserRegister
from App.backend.schemas.presets import PresetExportData
from App.backend.services.default_preset_seed import load_default_preset_seed


class FakeQuery:
    def __init__(self, session: "FakeSession") -> None:
        self._session = session

    def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def first(self) -> object:
        if self._session.first_results:
            return self._session.first_results.pop(0)
        return None


class FakeSession:
    def __init__(self, *, first_results: list[object] | None = None) -> None:
        self.first_results = list(first_results or [])
        self.added: list[object] = []
        self.commits = 0
        self.flushes = 0
        self.refreshed: list[object] = []

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flushes += 1

    def commit(self) -> None:
        self.commits += 1

    def refresh(self, obj: object) -> None:
        self.refreshed.append(obj)

    def query(self, _model: object) -> FakeQuery:
        return FakeQuery(self)


def _patch_folder_service(monkeypatch) -> None:
    folder_ids: dict[str, object] = {}

    def _fake_get_or_create_folder_by_path(_db, _user_id, _preset_id, folder_path: str):
        if folder_path not in folder_ids:
            folder_ids[folder_path] = uuid4()
        return SimpleNamespace(id=folder_ids[folder_path])

    monkeypatch.setattr(
        preset_service_module.FolderService,
        "get_or_create_folder_by_path",
        _fake_get_or_create_folder_by_path,
    )


def test_create_preset_and_initialize_default_preset_use_same_seed(monkeypatch) -> None:
    _patch_folder_service(monkeypatch)
    seed = load_default_preset_seed()

    create_session = FakeSession()
    create_response = preset_service_module.PresetService.create_preset(
        create_session,
        user_id=uuid4(),
        name="Custom",
        description="Custom description",
        initialize_with_defaults=True,
    )

    init_session = FakeSession()
    init_preset = preset_service_module.PresetService.initialize_default_preset(
        init_session,
        user_id=uuid4(),
    )

    created_scenarios = [row for row in create_session.added if isinstance(row, PromptScenarioVersion)]
    created_fragments = [row for row in create_session.added if isinstance(row, PromptFragment)]
    created_variables = [row for row in create_session.added if isinstance(row, PromptVariable)]
    created_sub_agents = [row for row in create_session.added if isinstance(row, SubAgentDefinitionModel)]

    init_scenarios = [row for row in init_session.added if isinstance(row, PromptScenarioVersion)]
    init_fragments = [row for row in init_session.added if isinstance(row, PromptFragment)]
    init_variables = [row for row in init_session.added if isinstance(row, PromptVariable)]
    init_sub_agents = [row for row in init_session.added if isinstance(row, SubAgentDefinitionModel)]

    assert create_response.prompt_count == len(seed.scenarios)
    assert create_response.fragment_count == len(seed.fragments)
    assert create_response.variable_count == len(seed.variables)
    assert len(created_scenarios) == len(init_scenarios) == len(seed.scenarios)
    assert len(created_fragments) == len(init_fragments) == len(seed.fragments)
    assert len(created_variables) == len(init_variables) == len(seed.variables)
    assert len(created_sub_agents) == len(init_sub_agents) == len(seed.sub_agents)
    assert all(row.is_default is True and row.note == "System default" for row in created_scenarios)
    assert all(row.is_default is True and row.note == "System default" for row in init_scenarios)
    assert create_session.commits == 1
    assert init_session.commits == 0
    assert init_preset.name == "Default"
    assert init_preset.description is None


def test_import_preset_uses_import_mode(monkeypatch) -> None:
    _patch_folder_service(monkeypatch)
    session = FakeSession()
    payload = PresetExportData.model_validate_json((ROOT / "App" / "backend" / "prompts" / "Default.nbprompt").read_text())

    response = preset_service_module.PresetService.import_preset(
        session,
        user_id=uuid4(),
        name="Imported",
        description=None,
        data=payload,
    )

    scenarios = [row for row in session.added if isinstance(row, PromptScenarioVersion)]
    fragments = [row for row in session.added if isinstance(row, PromptFragment)]

    assert response.prompt_count == len(scenarios)
    assert response.fragment_count == len(fragments)
    assert scenarios
    assert fragments
    assert all(row.is_default is False and row.note == "Imported" for row in scenarios)
    assert all(row.note == "Imported" for row in fragments)
    assert session.commits == 1


def test_register_fails_when_default_preset_init_fails(monkeypatch) -> None:
    session = FakeSession(first_results=[None, None])

    def _raise(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth_routes.preset_service, "initialize_default_preset", _raise)

    try:
        asyncio.run(
            auth_routes.register(
                UserRegister(
                    email="user@example.com",
                    username="tester",
                    password="secret123",
                ),
                db=session,
            )
        )
    except RuntimeError as exc:
        assert str(exc) == "boom"
    else:
        raise AssertionError("register() should propagate preset initialization failures")

    assert session.commits == 0
    assert any(isinstance(row, PromptPreset) for row in session.added) is False

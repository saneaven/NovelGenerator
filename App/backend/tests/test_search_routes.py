from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
import sys
import types
from uuid import uuid4

import pytest
from fastapi import HTTPException


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


fake_auth = types.ModuleType("App.backend.auth")
fake_auth.get_current_user = lambda: None
sys.modules["App.backend.auth"] = fake_auth

fake_database = types.ModuleType("App.backend.database")
fake_database.get_db = lambda: None
sys.modules["App.backend.database"] = fake_database
sys.modules["database"] = fake_database

fake_db_models = types.ModuleType("App.backend.models.db_models")
fake_db_models.User = type("User", (), {})
sys.modules["App.backend.models.db_models"] = fake_db_models

fake_embedding_config_service = types.ModuleType("App.backend.services.embedding_config_service")
fake_embedding_config_service.get_embedding_profile = lambda *_args, **_kwargs: {"provider": "openai", "model": "embed"}
sys.modules["App.backend.services.embedding_config_service"] = fake_embedding_config_service

fake_credential_service = types.ModuleType("App.backend.services.credential_service")
fake_credential_service.CredentialServiceError = type("CredentialServiceError", (Exception,), {})
fake_credential_service.credential_service = SimpleNamespace(get_provider_config=lambda *_args, **_kwargs: {})
sys.modules["App.backend.services.credential_service"] = fake_credential_service

fake_ownership = types.ModuleType("App.backend.services.ownership")
fake_ownership.require_owned_object = lambda *_args, **_kwargs: None
fake_ownership.require_owned_project = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.ownership"] = fake_ownership

fake_settings_service = types.ModuleType("App.backend.services.settings_service")
fake_settings_service.settings_service = SimpleNamespace(
    is_vector_storage_enabled=lambda *_args, **_kwargs: True,
    get_search_settings=lambda *_args, **_kwargs: SimpleNamespace(regex_page_size=20),
)
sys.modules["App.backend.services.settings_service"] = fake_settings_service

fake_semantic_index_service = types.ModuleType("App.backend.services.semantic_index_service")
fake_semantic_index_service.delete_object_index = lambda *_args, **_kwargs: 0
fake_semantic_index_service.get_project_status = lambda *_args, **_kwargs: {}
fake_semantic_index_service.index_object = lambda *_args, **_kwargs: {}
fake_semantic_index_service.reindex_project = lambda *_args, **_kwargs: {}
sys.modules["App.backend.services.semantic_index_service"] = fake_semantic_index_service

fake_semantic_search_service = types.ModuleType("App.backend.services.semantic_search_service")
fake_semantic_search_service.search_project = lambda *_args, **_kwargs: []
fake_semantic_search_service.search_project_by_regex = lambda *_args, **_kwargs: {"total": 0, "results": []}
sys.modules["App.backend.services.semantic_search_service"] = fake_semantic_search_service

from App.backend.routes import search_routes


def test_regex_search_route_returns_http_400_on_invalid_regex(monkeypatch) -> None:
    def _raise_invalid(*_args, **_kwargs):
        raise ValueError("Invalid regex pattern")

    monkeypatch.setattr(search_routes, "require_owned_project", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(search_routes, "_require_vector_storage_enabled", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(search_routes, "search_project_by_regex", _raise_invalid)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            search_routes.regex_search(
                project_id=uuid4(),
                pattern="(",
                case_sensitive=False,
                page=1,
                current_user=SimpleNamespace(id=uuid4()),
                db=object(),
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid regex pattern"


def test_regex_search_route_returns_regex_response(monkeypatch) -> None:
    result_row = {
        "chunk_id": uuid4(),
        "source_id": uuid4(),
        "object_type": "story_entity",
        "object_id": uuid4(),
        "type_group": "story_entity",
        "story_entity_kind": "character",
        "story_entity_order": 1,
        "outline_order": None,
        "act_order": None,
        "chapter_order": None,
        "chapter_id": None,
        "field_path": "content",
        "chunk_index": 0,
        "text": "Hero wound",
        "distance": None,
    }

    monkeypatch.setattr(search_routes, "require_owned_project", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(search_routes, "_require_vector_storage_enabled", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        search_routes.settings_service,
        "get_search_settings",
        lambda *_args, **_kwargs: SimpleNamespace(regex_page_size=7),
    )
    monkeypatch.setattr(
        search_routes,
        "search_project_by_regex",
        lambda *_args, **_kwargs: {"total": 1, "results": [result_row]},
    )

    response = asyncio.run(
        search_routes.regex_search(
            project_id=uuid4(),
            pattern="hero.*",
            case_sensitive=True,
            page=2,
            current_user=SimpleNamespace(id=uuid4()),
            db=object(),
        )
    )

    assert response.pattern == "hero.*"
    assert response.case_sensitive is True
    assert response.page == 2
    assert response.page_size == 7
    assert response.total == 1
    assert len(response.results) == 1

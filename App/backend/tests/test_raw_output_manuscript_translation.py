from __future__ import annotations

import asyncio
import copy
import importlib
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

    token_count_service = types.ModuleType("App.backend.services.token_count_service")

    async def _count_text_tokens(*_args, **_kwargs):
        return SimpleNamespace(token_count=0)

    token_count_service.count_text_tokens = _count_text_tokens
    sys.modules["App.backend.services.token_count_service"] = token_count_service

    object_service_module = types.ModuleType("App.backend.services.object_service")
    object_service_module.object_service = SimpleNamespace(
        get_object=lambda *_args, **_kwargs: None,
        update_object=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.object_service"] = object_service_module

    sidecar_client_module = types.ModuleType("App.backend.services.sidecar_client")
    sidecar_client_module.sidecar_client = SimpleNamespace(
        markdown_to_doc=lambda *_args, **_kwargs: None
    )
    sys.modules["App.backend.services.sidecar_client"] = sidecar_client_module

    run_pipeline_package = types.ModuleType("App.backend.services.run_pipeline")
    run_pipeline_package.__path__ = [
        str(ROOT / "App" / "backend" / "services" / "run_pipeline")
    ]
    sys.modules["App.backend.services.run_pipeline"] = run_pipeline_package


_install_import_stubs()

raw_output_module = importlib.import_module("App.backend.services.run_pipeline.raw_output")
from App.backend.services.manuscript_image_index_service import extract_asset_ids_with_positions


class FakeQuery:
    def __init__(self, first_result) -> None:
        self._first_result = first_result

    def filter(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def order_by(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def first(self):
        return self._first_result


class FakeSession:
    def __init__(self, object_type: str) -> None:
        self.object_type = object_type

    def query(self, _model) -> FakeQuery:
        return FakeQuery((self.object_type,))

    def flush(self) -> None:
        return None


async def _noop_emit(**_kwargs) -> None:
    return None


def test_raw_object_translation_restores_asset_ids_from_source_language(monkeypatch) -> None:
    object_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    asset_id = uuid4()
    image_src = "https://example.com/storage/assets/image-a.png"

    original_doc = {
        "type": "doc",
        "content": [
            {
                "type": "image",
                "attrs": {
                    "src": image_src,
                    "data-asset-id": str(asset_id),
                    "width": 512,
                },
            }
        ],
    }
    translated_doc = {
        "type": "doc",
        "content": [
            {
                "type": "image",
                "attrs": {
                    "src": image_src,
                    "width": 512,
                },
            }
        ],
    }

    captured: dict[str, object] = {}
    get_calls: list[dict[str, object]] = []
    expected_object_id = object_id
    expected_project_id = project_id

    class DummyObjectService:
        def get_object(self, _db, object_type, object_id, *, project_id, language=None):
            assert object_id == expected_object_id
            assert project_id == expected_project_id
            get_calls.append(
                {
                    "object_type": object_type,
                    "object_id": object_id,
                    "project_id": project_id,
                    "language": language,
                }
            )
            return {
                "data": {
                    "English": {
                        "doc": copy.deepcopy(original_doc),
                        "wordCount": 12,
                    }
                }
            }

        def update_object(self, _db, **kwargs):
            captured.update(kwargs)
            return {"id": str(object_id)}

    class DummySidecar:
        async def markdown_to_doc(self, markdown: str):
            assert markdown == "translated manuscript"
            return copy.deepcopy(translated_doc)

    monkeypatch.setattr(raw_output_module, "object_service", DummyObjectService())
    monkeypatch.setattr(raw_output_module, "sidecar_client", DummySidecar())

    asyncio.run(
        raw_output_module.apply_raw_output(
            FakeSession("manuscript"),
            thread=SimpleNamespace(journey_kind="objectTranslation"),
            run=SimpleNamespace(id=uuid4(), project_id=project_id, user_id=user_id, language="Korean"),
            input_payload={
                "translation": {
                    "objectIds": [str(object_id)],
                    "sourceLanguage": "English",
                    "targetLanguage": "Korean",
                }
            },
            content_parts=[{"type": "content", "text": "translated manuscript"}],
            emit_fn=_noop_emit,
        )
    )

    assert get_calls == [
        {
            "object_type": "manuscript",
            "object_id": object_id,
            "project_id": project_id,
            "language": None,
        }
    ]
    assert captured["language"] == "Korean"
    assert captured["create_new_version"] is False
    saved_doc = captured["data"]["doc"]
    assert saved_doc["content"][0]["attrs"]["data-asset-id"] == str(asset_id)
    assert extract_asset_ids_with_positions(saved_doc) == [(asset_id, 0, 512)]


def test_raw_object_translation_restores_asset_ids_from_first_available_language(monkeypatch) -> None:
    object_id = uuid4()
    project_id = uuid4()
    expected_object_id = object_id
    expected_project_id = project_id
    user_id = uuid4()
    asset_id = uuid4()
    image_src = "https://example.com/storage/assets/image-b.png"

    fallback_doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "Fallback"}],
            },
            {
                "type": "image",
                "attrs": {
                    "src": image_src,
                    "data-asset-id": str(asset_id),
                },
            },
        ],
    }
    translated_doc = {
        "type": "doc",
        "content": [
            {
                "type": "image",
                "attrs": {
                    "src": image_src,
                },
            }
        ],
    }

    captured: dict[str, object] = {}

    class DummyObjectService:
        def get_object(self, _db, object_type, object_id, *, project_id, language=None):
            assert object_type == "manuscript"
            assert object_id == expected_object_id
            assert project_id == expected_project_id
            assert language is None
            return {
                "data": {
                    "Japanese": {
                        "doc": copy.deepcopy(fallback_doc),
                        "wordCount": 7,
                    }
                }
            }

        def update_object(self, _db, **kwargs):
            captured.update(kwargs)
            return {"id": str(object_id)}

    class DummySidecar:
        async def markdown_to_doc(self, markdown: str):
            assert markdown == "translated with fallback"
            return copy.deepcopy(translated_doc)

    monkeypatch.setattr(raw_output_module, "object_service", DummyObjectService())
    monkeypatch.setattr(raw_output_module, "sidecar_client", DummySidecar())

    asyncio.run(
        raw_output_module.apply_raw_output(
            FakeSession("manuscript"),
            thread=SimpleNamespace(journey_kind="objectTranslation"),
            run=SimpleNamespace(id=uuid4(), project_id=project_id, user_id=user_id, language="Korean"),
            input_payload={
                "translation": {
                    "objectIds": [str(object_id)],
                    "sourceLanguage": "English",
                    "targetLanguage": "Korean",
                }
            },
            content_parts=[{"type": "content", "text": "translated with fallback"}],
            emit_fn=_noop_emit,
        )
    )

    saved_doc = captured["data"]["doc"]
    assert saved_doc["content"][0]["attrs"]["data-asset-id"] == str(asset_id)


def test_raw_object_translation_non_manuscript_path_is_unchanged(monkeypatch) -> None:
    object_id = uuid4()
    project_id = uuid4()
    expected_object_id = object_id
    expected_project_id = project_id
    user_id = uuid4()
    captured: dict[str, object] = {}
    get_calls: list[dict[str, object]] = []

    class DummyObjectService:
        def get_object(self, _db, object_type, object_id, *, project_id, language=None):
            assert object_id == expected_object_id
            assert project_id == expected_project_id
            get_calls.append(
                {
                    "object_type": object_type,
                    "object_id": object_id,
                    "project_id": project_id,
                    "language": language,
                }
            )
            return {
                "data": {
                    "Korean": {
                        "content": "old content",
                    }
                }
            }

        def update_object(self, _db, **kwargs):
            captured.update(kwargs)
            return {"id": str(object_id)}

    class DummySidecar:
        async def markdown_to_doc(self, _markdown: str):
            raise AssertionError("markdown_to_doc should not be used for non-manuscript translation")

    monkeypatch.setattr(raw_output_module, "object_service", DummyObjectService())
    monkeypatch.setattr(raw_output_module, "sidecar_client", DummySidecar())

    asyncio.run(
        raw_output_module.apply_raw_output(
            FakeSession("character"),
            thread=SimpleNamespace(journey_kind="objectTranslation"),
            run=SimpleNamespace(id=uuid4(), project_id=project_id, user_id=user_id, language="Korean"),
            input_payload={
                "translation": {
                    "objectIds": [str(object_id)],
                    "sourceLanguage": "English",
                    "targetLanguage": "Korean",
                }
            },
            content_parts=[{"type": "content", "text": "new translated content"}],
            emit_fn=_noop_emit,
        )
    )

    assert get_calls == [
        {
            "object_type": "character",
            "object_id": object_id,
            "project_id": project_id,
            "language": "Korean",
        }
    ]
    assert captured["data"] == {"content": "new translated content"}
    assert captured["language"] == "Korean"
    assert captured["create_new_version"] is False

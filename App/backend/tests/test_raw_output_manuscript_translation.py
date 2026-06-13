from __future__ import annotations

import asyncio
import importlib
import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")


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

    markdown_it_pyrs = types.ModuleType("markdown_it_pyrs")

    class _FakeMarkdownIt:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def enable_many(self, *_args, **_kwargs):
            return self

    markdown_it_pyrs.MarkdownIt = _FakeMarkdownIt
    sys.modules["markdown_it_pyrs"] = markdown_it_pyrs

    object_service_module = types.ModuleType("App.backend.services.object_service")
    object_service_module.object_service = SimpleNamespace(
        get_object=lambda *_args, **_kwargs: None,
        update_object=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.object_service"] = object_service_module

    chat_attachment_service_module = types.ModuleType("App.backend.services.chat_attachment_service")
    chat_attachment_service_module.chat_attachment_service = SimpleNamespace(
        load_attachment_bytes=lambda *_args, **_kwargs: b"",
        to_data_url=lambda *_args, **_kwargs: "data:application/octet-stream;base64,",
    )
    sys.modules["App.backend.services.chat_attachment_service"] = chat_attachment_service_module

    run_pipeline_package = types.ModuleType("App.backend.services.run_pipeline")
    run_pipeline_package.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline")]
    sys.modules["App.backend.services.run_pipeline"] = run_pipeline_package


_install_import_stubs()

raw_output_module = importlib.import_module("App.backend.services.run_pipeline.raw_output")


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


def _set_object_translation_parent(monkeypatch) -> None:
    monkeypatch.setattr(
        raw_output_module,
        "resolve_parent",
        lambda *_args, **_kwargs: SimpleNamespace(journey_kind="objectTranslation"),
    )


def test_raw_object_translation_manuscript_uses_markdown_projection(monkeypatch) -> None:
    object_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}
    get_calls: list[dict[str, object]] = []

    class DummyObjectService:
        def get_object(self, _db, object_type, object_id, *, project_id, language=None, **kwargs):
            get_calls.append(
                {
                    "object_type": object_type,
                    "object_id": object_id,
                    "project_id": project_id,
                    "language": language,
                    **kwargs,
                }
            )
            return {
                "data": {
                    "content": "# Existing manuscript",
                    "wordCount": 2,
                }
            }

        def update_object(self, _db, **kwargs):
            captured.update(kwargs)
            return {"id": str(object_id)}

    monkeypatch.setattr(raw_output_module, "object_service", DummyObjectService())
    _set_object_translation_parent(monkeypatch)

    asyncio.run(
        raw_output_module.apply_raw_output(
            FakeSession("manuscript"),
            thread=SimpleNamespace(parent_id=uuid4(), thread_type="journey"),
            run=SimpleNamespace(id=uuid4(), project_id=project_id, user_id=user_id, language="Korean"),
            input_payload={
                "translation": {
                    "objectIds": [str(object_id)],
                    "sourceLanguage": "English",
                    "targetLanguage": "Korean",
                }
            },
            content_parts=[{"type": "content", "text": "# Translated manuscript"}],
            emit_fn=_noop_emit,
        )
    )

    assert get_calls == [
        {
            "object_type": "manuscript",
            "object_id": object_id,
            "project_id": project_id,
            "language": "Korean",
            "rich_text_format": "markdown",
        }
    ]
    assert captured["data"] == {"content": "# Translated manuscript"}
    assert captured["rich_text_format"] == "markdown"
    assert captured["language"] == "Korean"
    assert captured["create_new_version"] is False


def test_raw_object_translation_story_entity_stays_markdown_based(monkeypatch) -> None:
    object_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}
    get_calls: list[dict[str, object]] = []

    class DummyObjectService:
        def get_object(self, _db, object_type, object_id, *, project_id, language=None, **kwargs):
            get_calls.append(
                {
                    "object_type": object_type,
                    "object_id": object_id,
                    "project_id": project_id,
                    "language": language,
                    **kwargs,
                }
            )
            return {
                "data": {
                    "name": "Ari",
                    "description": "Broker",
                    "content": "old content",
                }
            }

        def update_object(self, _db, **kwargs):
            captured.update(kwargs)
            return {"id": str(object_id)}

    monkeypatch.setattr(raw_output_module, "object_service", DummyObjectService())
    _set_object_translation_parent(monkeypatch)

    asyncio.run(
        raw_output_module.apply_raw_output(
            FakeSession("story_entity"),
            thread=SimpleNamespace(parent_id=uuid4(), thread_type="journey"),
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
            "object_type": "story_entity",
            "object_id": object_id,
            "project_id": project_id,
            "language": "Korean",
            "rich_text_format": "markdown",
        }
    ]
    assert captured["data"]["content"] == "new translated content"
    assert captured["data"]["name"] == "Ari"
    assert captured["data"]["description"] == "Broker"
    assert captured["rich_text_format"] == "markdown"
    assert captured["language"] == "Korean"
    assert captured["create_new_version"] is False


def test_raw_object_translation_timeline_track_uses_markdown_projection(monkeypatch) -> None:
    object_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}
    get_calls: list[dict[str, object]] = []

    class DummyObjectService:
        def get_object(self, _db, object_type, object_id, *, project_id, language=None, **kwargs):
            get_calls.append(
                {
                    "object_type": object_type,
                    "object_id": object_id,
                    "project_id": project_id,
                    "language": language,
                    **kwargs,
                }
            )
            return {
                "data": {
                    "name": "Track",
                    "description": "Track desc",
                    "content": "old timeline markdown",
                }
            }

        def update_object(self, _db, **kwargs):
            captured.update(kwargs)
            return {"id": str(object_id)}

    monkeypatch.setattr(raw_output_module, "object_service", DummyObjectService())
    _set_object_translation_parent(monkeypatch)

    asyncio.run(
        raw_output_module.apply_raw_output(
            FakeSession("timeline_track"),
            thread=SimpleNamespace(parent_id=uuid4(), thread_type="journey"),
            run=SimpleNamespace(id=uuid4(), project_id=project_id, user_id=user_id, language="Korean"),
            input_payload={
                "translation": {
                    "objectIds": [str(object_id)],
                    "sourceLanguage": "English",
                    "targetLanguage": "Korean",
                }
            },
            content_parts=[{"type": "content", "text": "new translated timeline markdown"}],
            emit_fn=_noop_emit,
        )
    )

    assert get_calls == [
        {
            "object_type": "timeline_track",
            "object_id": object_id,
            "project_id": project_id,
            "language": "Korean",
            "rich_text_format": "markdown",
        }
    ]
    assert captured["rich_text_format"] == "markdown"
    assert captured["data"]["content"] == "new translated timeline markdown"
    assert captured["data"]["name"] == "Track"
    assert captured["data"]["description"] == "Track desc"


def test_raw_object_translation_basic_info_uses_projection(monkeypatch) -> None:
    object_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}
    get_calls: list[dict[str, object]] = []

    class DummyObjectService:
        def get_object(self, _db, object_type, object_id, *, project_id, language=None, **kwargs):
            get_calls.append(
                {
                    "object_type": object_type,
                    "object_id": object_id,
                    "project_id": project_id,
                    "language": language,
                    **kwargs,
                }
            )
            return {
                "data": {
                    "title": "Novel",
                    "logline": "Old logline",
                }
            }

        def update_object(self, _db, **kwargs):
            captured.update(kwargs)
            return {"id": str(object_id)}

    monkeypatch.setattr(raw_output_module, "object_service", DummyObjectService())
    _set_object_translation_parent(monkeypatch)

    asyncio.run(
        raw_output_module.apply_raw_output(
            FakeSession("basic_info"),
            thread=SimpleNamespace(parent_id=uuid4(), thread_type="journey"),
            run=SimpleNamespace(id=uuid4(), project_id=project_id, user_id=user_id, language="Korean"),
            input_payload={
                "translation": {
                    "objectIds": [str(object_id)],
                    "sourceLanguage": "English",
                    "targetLanguage": "Korean",
                }
            },
            content_parts=[{"type": "content", "text": "New logline"}],
            emit_fn=_noop_emit,
        )
    )

    assert get_calls == [
        {
            "object_type": "basic_info",
            "object_id": object_id,
            "project_id": project_id,
            "language": "Korean",
        }
    ]
    assert "rich_text_format" not in captured
    assert captured["data"]["title"] == "Novel"
    assert captured["data"]["logline"] == "New logline"

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from App.backend.services import object_service as object_service_module
from App.backend.services.tool_engine.modules.object_access import extract_lang_data


def _latest_version(*rows: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        version_number=7,
        created_at=datetime(2026, 1, 1, 12, 0, 0),
        languages=list(rows),
    )


def _row(language: str, data: dict[str, object], offset: int) -> SimpleNamespace:
    return SimpleNamespace(
        language=language,
        data=data,
        created_at=datetime(2026, 1, 1, 12, offset, 0),
    )


def _payload(object_type: str, name: str) -> dict[str, object]:
    if object_type == "basic_info":
        return {"title": name, "logline": "Logline", "genres": [], "tags": []}
    if object_type == "guidelines":
        return {"authorNote": f"{name} note"}
    if object_type == "manuscript":
        return {"content": f"{name} body", "wordCount": 2}
    return {"name": name, "description": "Description", "content": f"{name} body"}


def test_extract_lang_data_returns_projection_payload_without_language_lookup() -> None:
    content = {"type": "doc", "content": [{"type": "paragraph"}]}
    obj = {
        "data": {
            "name": "Projected name",
            "description": "Projected description",
            "content": content,
        },
        "language_state": {
            "requested_language": "Korean",
            "content_language": "Korean",
            "fallback_to": None,
            "available_languages": ["English", "Korean"],
            "has_requested_language": True,
            "is_fallback": False,
        },
    }

    assert extract_lang_data(obj, "Korean") == obj["data"]


@pytest.mark.parametrize(
    "object_type",
    [
        "basic_info",
        "guidelines",
        "story_entity_folder",
        "story_entity",
        "outline",
        "manuscript",
        "timeline_track",
        "timeline_event",
    ],
)
def test_serialize_object_returns_single_language_projection_for_all_object_types(monkeypatch, object_type: str) -> None:
    obj = SimpleNamespace(id=uuid4(), kind="character")
    latest = _latest_version(
        _row("English", _payload(object_type, "English Name"), 0),
        _row("Korean", _payload(object_type, "Korean Name"), 1),
    )

    monkeypatch.setattr(object_service_module, "latest_version_with_all_languages", lambda *_args, **_kwargs: latest)
    monkeypatch.setattr(object_service_module, "_get_metadata", lambda *_args, **_kwargs: {"project_id": str(uuid4())})

    result = object_service_module._serialize_object(
        SimpleNamespace(),
        object_type,
        obj,
        language="Korean",
        fallback_language="English",
        rich_text_format="markdown",
    )

    assert "Korean" not in result["data"]
    assert "English" not in result["data"]
    assert result["language_state"] == {
        "requested_language": "Korean",
        "content_language": "Korean",
        "fallback_to": None,
        "available_languages": ["English", "Korean"],
        "has_requested_language": True,
        "is_fallback": False,
    }


def test_serialize_object_marks_backend_fallback_language(monkeypatch) -> None:
    obj = SimpleNamespace(id=uuid4(), kind="character")
    latest = _latest_version(
        _row("English", {"name": "English Name", "description": "", "content": "Body"}, 0),
    )

    monkeypatch.setattr(object_service_module, "latest_version_with_all_languages", lambda *_args, **_kwargs: latest)
    monkeypatch.setattr(object_service_module, "_get_metadata", lambda *_args, **_kwargs: {"project_id": str(uuid4())})

    result = object_service_module._serialize_object(
        SimpleNamespace(),
        "timeline_event",
        obj,
        language="Korean",
        fallback_language="English",
        rich_text_format="markdown",
    )

    assert result["data"]["name"] == "English Name"
    assert result["language_state"] == {
        "requested_language": "Korean",
        "content_language": "English",
        "fallback_to": "English",
        "available_languages": ["English"],
        "has_requested_language": False,
        "is_fallback": True,
    }

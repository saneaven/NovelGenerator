from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from App.backend.services import object_content_token_service as service


def test_story_entity_token_text_includes_content() -> None:
    selected = service.SelectedObject(
        object_type="story_entity",
        row=SimpleNamespace(id=uuid4()),
        serialized={
            "id": str(uuid4()),
            "type": "story_entity",
            "kind": "character",
            "metadata": {},
            "data": {
                "name": "Ari",
                "description": "Pilot",
                "content": "Ari keeps the forbidden map.",
            },
        },
        order=0,
    )

    text = service.token_text_for_selected_object(
        None,  # type: ignore[arg-type]
        selected,
        language="English",
        timeline_calendar={"units": [{"name": "year", "label": "Year"}]},
    )

    assert "Kind: character" in text
    assert "Name: Ari" in text
    assert "Description: Pilot" in text
    assert "Content: Ari keeps the forbidden map." in text


def test_timeline_event_token_text_includes_track_date_content_and_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    track = SimpleNamespace(id=uuid4())

    def fake_serialize(*_args, object_type: str, row, **_kwargs):
        assert object_type == "timeline_track"
        assert row is track
        return {"data": {"name": "Main Track"}, "metadata": {}}

    monkeypatch.setattr(service, "_serialize", fake_serialize)

    selected = service.SelectedObject(
        object_type="timeline_event",
        row=SimpleNamespace(id=uuid4(), track=track),
        serialized={
            "id": str(uuid4()),
            "type": "timeline_event",
            "metadata": {
                "start_date": {"year": 1, "month": 2},
                "end_date": {"year": 1, "month": 3},
                "tags": ["seed", "setup"],
            },
            "data": {
                "name": "Opening Event",
                "description": "Inciting incident",
                "content": "The signal appears over the city.",
            },
        },
        order=0,
    )

    text = service.token_text_for_selected_object(
        None,  # type: ignore[arg-type]
        selected,
        language="English",
        timeline_calendar={
            "units": [
                {"name": "year", "label": "Year", "count": 12},
                {"name": "month", "label": "Month"},
            ],
        },
    )

    assert "Track: Main Track" in text
    assert "Date: Year 1 / Month 2 - Year 1 / Month 3" in text
    assert "Name: Opening Event" in text
    assert "Description: Inciting incident" in text
    assert "Content: The signal appears over the city." in text
    assert "Tags: seed, setup" in text


def test_build_selected_object_token_text_rejects_unowned_project(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import HTTPException

    def reject_project(*_args, **_kwargs):
        raise HTTPException(status_code=404, detail="Project not found")

    monkeypatch.setattr(service, "require_owned_project", reject_project)

    with pytest.raises(HTTPException) as exc_info:
        service.build_selected_object_token_text(
            None,  # type: ignore[arg-type]
            user_id=uuid4(),
            project_id=uuid4(),
            object_ids=[],
            language="English",
        )

    assert exc_info.value.status_code == 404

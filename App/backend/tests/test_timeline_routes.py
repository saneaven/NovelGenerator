from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from App.backend.routes import timeline_routes
from App.backend.services import timeline_service as timeline_service_module


class FakeDb:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


def test_update_event_omitted_links_passes_shared_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    project_id = uuid4()
    event_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}

    def fake_update_event(db, **kwargs):
        captured.update(kwargs)
        return {}

    monkeypatch.setattr(timeline_routes, "require_owned_project", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(timeline_routes.timeline_service, "update_event", fake_update_event)
    monkeypatch.setattr(timeline_routes, "_serialized_object", lambda *_args, **_kwargs: {"ok": True})

    db = FakeDb()
    response = asyncio.run(
        timeline_routes.update_event(
            project_id=project_id,
            event_id=event_id,
            request=timeline_routes.TimelineEventUpdate(language="English", name="Updated Event"),
            db=db,
            current_user=SimpleNamespace(id=user_id),
        )
    )

    assert response == {"ok": True}
    assert captured["links"] is timeline_service_module._UNSET
    assert timeline_routes._UNSET is timeline_service_module._UNSET
    assert db.commits == 1
    assert db.rollbacks == 0


def test_update_track_omitted_content_and_color_pass_shared_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    project_id = uuid4()
    track_id = uuid4()
    user_id = uuid4()
    captured: dict[str, object] = {}

    def fake_update_track(db, **kwargs):
        captured.update(kwargs)
        return {}

    monkeypatch.setattr(timeline_routes, "require_owned_project", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(timeline_routes.timeline_service, "update_track", fake_update_track)
    monkeypatch.setattr(timeline_routes, "_serialized_object", lambda *_args, **_kwargs: {"ok": True})

    db = FakeDb()
    response = asyncio.run(
        timeline_routes.update_track(
            project_id=project_id,
            track_id=track_id,
            request=timeline_routes.TimelineTrackUpdate(language="English", name="Updated Track"),
            db=db,
            current_user=SimpleNamespace(id=user_id),
        )
    )

    assert response == {"ok": True}
    assert captured["content"] is timeline_service_module._UNSET
    assert captured["color"] is timeline_service_module._UNSET
    assert timeline_routes._UNSET is timeline_service_module._UNSET
    assert db.commits == 1
    assert db.rollbacks == 0

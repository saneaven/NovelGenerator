from __future__ import annotations

import asyncio
from uuid import uuid4

from App.backend.services import asset_change_events


class FakeSession:
    def __init__(self) -> None:
        self.info: dict[object, object] = {}


def _run_after_commit(session: FakeSession) -> None:
    async def _runner() -> None:
        asset_change_events._after_commit(session)  # noqa: SLF001
        await asyncio.sleep(0)

    asyncio.run(_runner())


def test_queue_asset_change_deduplicates_by_priority() -> None:
    session = FakeSession()
    user_id = uuid4()
    project_id = uuid4()
    object_id = uuid4()

    asset_change_events.queue_asset_change(
        session,
        user_id=user_id,
        project_id=project_id,
        scope="story_object_assets",
        action="updated",
        object_type="character",
        object_id=object_id,
    )
    asset_change_events.queue_asset_change(
        session,
        user_id=user_id,
        project_id=project_id,
        scope="story_object_assets",
        action="created",
        object_type="character",
        object_id=object_id,
    )
    asset_change_events.queue_asset_change(
        session,
        user_id=user_id,
        project_id=project_id,
        scope="story_object_assets",
        action="deleted",
        object_type="character",
        object_id=object_id,
    )

    pending = session.info[asset_change_events._PENDING_ASSET_CHANGES_KEY]  # noqa: SLF001
    assert len(pending) == 1
    assert list(pending.values()) == ["deleted"]


def test_after_rollback_clears_pending_changes() -> None:
    session = FakeSession()

    asset_change_events.queue_scene_assets_change(
        session,
        user_id=uuid4(),
        project_id=uuid4(),
        manuscript_id=uuid4(),
        action="updated",
    )
    assert asset_change_events._PENDING_ASSET_CHANGES_KEY in session.info  # noqa: SLF001

    asset_change_events._after_rollback(session)  # noqa: SLF001

    assert asset_change_events._PENDING_ASSET_CHANGES_KEY not in session.info  # noqa: SLF001


def test_after_commit_emits_batched_asset_changes_per_project(monkeypatch) -> None:
    session = FakeSession()
    user_id = uuid4()
    project_id = uuid4()

    emitted: list[tuple[str, str, list[dict[str, object]]]] = []

    async def _fake_emit(user_id_text: str, project_id_text: str, changes: list[dict[str, object]]) -> None:
        emitted.append((user_id_text, project_id_text, changes))

    monkeypatch.setattr(asset_change_events, "_emit_asset_change_batch", _fake_emit)

    asset_change_events.queue_project_assets_change(
        session,
        user_id=user_id,
        project_id=project_id,
        action="created",
    )
    asset_change_events.queue_story_object_assets_change(
        session,
        user_id=user_id,
        project_id=project_id,
        object_type="character",
        object_id=uuid4(),
        action="updated",
    )
    manuscript_id = uuid4()
    asset_change_events.queue_scene_assets_change(
        session,
        user_id=user_id,
        project_id=project_id,
        manuscript_id=None,
        action="updated",
    )
    asset_change_events.queue_scene_assets_change(
        session,
        user_id=user_id,
        project_id=project_id,
        manuscript_id=manuscript_id,
        action="updated",
    )

    _run_after_commit(session)

    assert asset_change_events._PENDING_ASSET_CHANGES_KEY not in session.info  # noqa: SLF001
    assert len(emitted) == 1

    emitted_user_id, emitted_project_id, changes = emitted[0]
    assert emitted_user_id == str(user_id)
    assert emitted_project_id == str(project_id)
    assert {"scope": "project_assets", "action": "created"} in changes
    assert any(
        change.get("scope") == "story_object_assets"
        and change.get("action") == "updated"
        and change.get("object_type") == "character"
        and isinstance(change.get("object_id"), str)
        for change in changes
    )
    assert {"scope": "scene_assets", "action": "updated", "manuscript_id": None} in changes
    assert {"scope": "scene_assets", "action": "updated", "manuscript_id": str(manuscript_id)} in changes

from __future__ import annotations

import asyncio
from uuid import uuid4

from App.backend.services import object_change_events


class FakeSession:
    def __init__(self) -> None:
        self.info: dict[object, object] = {}


def _run_after_commit(session: FakeSession) -> None:
    async def _runner() -> None:
        object_change_events._after_commit(session)  # noqa: SLF001
        await asyncio.sleep(0)

    asyncio.run(_runner())


def test_queue_object_change_deduplicates_by_priority() -> None:
    session = FakeSession()
    project_id = uuid4()
    object_id = uuid4()

    object_change_events.queue_object_change(
        session,
        project_id=project_id,
        object_type="character",
        object_id=object_id,
        action="updated",
    )
    object_change_events.queue_object_change(
        session,
        project_id=project_id,
        object_type="character",
        object_id=object_id,
        action="created",
    )
    object_change_events.queue_object_change(
        session,
        project_id=project_id,
        object_type="character",
        object_id=object_id,
        action="deleted",
    )

    pending = session.info[object_change_events._PENDING_OBJECT_CHANGES_KEY]  # noqa: SLF001
    assert len(pending) == 1
    assert list(pending.values()) == ["deleted"]


def test_after_rollback_clears_pending_changes() -> None:
    session = FakeSession()

    object_change_events.queue_object_change(
        session,
        project_id=uuid4(),
        object_type="character",
        object_id=uuid4(),
        action="updated",
    )
    assert object_change_events._PENDING_OBJECT_CHANGES_KEY in session.info  # noqa: SLF001

    object_change_events._after_rollback(session)  # noqa: SLF001

    assert object_change_events._PENDING_OBJECT_CHANGES_KEY not in session.info  # noqa: SLF001


def test_after_commit_emits_single_batch_per_project(monkeypatch) -> None:
    session = FakeSession()
    project_a = uuid4()
    project_b = uuid4()

    emitted: list[tuple[str, list[dict[str, str]]]] = []

    async def _fake_emit(project_id: str, changes: list[dict[str, str]]) -> None:
        emitted.append((project_id, changes))

    monkeypatch.setattr(object_change_events, "_emit_object_change_batch", _fake_emit)

    object_change_events.queue_object_change(
        session,
        project_id=project_a,
        object_type="character",
        object_id=uuid4(),
        action="created",
    )
    object_change_events.queue_object_change(
        session,
        project_id=project_a,
        object_type="chapter",
        object_id=uuid4(),
        action="updated",
    )
    object_change_events.queue_object_change(
        session,
        project_id=project_b,
        object_type="manuscript",
        object_id=uuid4(),
        action="deleted",
    )

    _run_after_commit(session)

    assert object_change_events._PENDING_OBJECT_CHANGES_KEY not in session.info  # noqa: SLF001
    assert len(emitted) == 2

    by_project = {project_id: changes for project_id, changes in emitted}
    assert str(project_a) in by_project
    assert str(project_b) in by_project

    project_a_actions = {entry["action"] for entry in by_project[str(project_a)]}
    project_b_actions = {entry["action"] for entry in by_project[str(project_b)]}

    assert project_a_actions == {"created", "updated"}
    assert project_b_actions == {"deleted"}

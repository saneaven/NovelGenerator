from __future__ import annotations

from uuid import uuid4

from App.backend.services.memory.archive_orchestrator import BoundaryChoice, _pick_boundary_from_rows


def test_pick_boundary_uses_oldest_half_and_skips_active_user_turn() -> None:
    first = BoundaryChoice(message_id=uuid4(), role="user", seq_in_thread=1)
    active_user = BoundaryChoice(message_id=uuid4(), role="user", seq_in_thread=2)
    third = BoundaryChoice(message_id=uuid4(), role="assistant", seq_in_thread=3)
    fourth = BoundaryChoice(message_id=uuid4(), role="assistant", seq_in_thread=4)

    boundary = _pick_boundary_from_rows(
        [first, active_user, third, fourth],
        current_run_user_message_id=active_user.message_id,
    )

    assert boundary == first


def test_pick_boundary_returns_none_when_only_active_user_would_be_archived() -> None:
    active_user = BoundaryChoice(message_id=uuid4(), role="user", seq_in_thread=1)
    latest = BoundaryChoice(message_id=uuid4(), role="assistant", seq_in_thread=2)

    boundary = _pick_boundary_from_rows(
        [active_user, latest],
        current_run_user_message_id=active_user.message_id,
    )

    assert boundary is None

from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy import inspect as sa_inspect, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import undefer

from App.backend.models.db_models import Thread
from App.backend.services.run_pipeline.prompt_assembly import _load_captured_prompt_snapshot


def _compiled_sql(statement: object) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def test_thread_snapshot_is_deferred_from_default_orm_select() -> None:
    snapshot_property = Thread.__mapper__.get_property("captured_prompt_snapshot")

    assert snapshot_property.deferred is True
    assert "captured_prompt_snapshot" not in _compiled_sql(select(Thread))


def test_thread_snapshot_can_be_explicitly_undeferred() -> None:
    statement = select(Thread).options(undefer(Thread.captured_prompt_snapshot))

    assert "captured_prompt_snapshot" in _compiled_sql(statement)


def test_prompt_snapshot_loader_refreshes_only_an_unloaded_snapshot() -> None:
    thread = Thread()
    calls: list[tuple[object, tuple[str, ...]]] = []

    class _Db:
        @staticmethod
        def refresh(row: object, *, attribute_names: list[str]) -> None:
            calls.append((row, tuple(attribute_names)))
            row.captured_prompt_snapshot = {"systemPrompt": "sentinel"}

    assert "captured_prompt_snapshot" in sa_inspect(thread).unloaded

    _load_captured_prompt_snapshot(_Db(), thread)  # type: ignore[arg-type]
    _load_captured_prompt_snapshot(_Db(), thread)  # type: ignore[arg-type]

    assert calls == [(thread, ("captured_prompt_snapshot",))]
    assert thread.captured_prompt_snapshot == {"systemPrompt": "sentinel"}


def test_prompt_snapshot_loader_ignores_non_orm_test_rows() -> None:
    thread = SimpleNamespace(captured_prompt_snapshot={"systemPrompt": "sentinel"})

    _load_captured_prompt_snapshot(SimpleNamespace(), thread)  # type: ignore[arg-type]

    assert thread.captured_prompt_snapshot == {"systemPrompt": "sentinel"}

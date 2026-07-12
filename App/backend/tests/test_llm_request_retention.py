from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

from App.backend.services import llm_request_service as service_module


class _Result:
    def __init__(self, project_ids: list[UUID]) -> None:
        self._project_ids = project_ids

    def all(self) -> list[tuple[UUID]]:
        return [(project_id,) for project_id in self._project_ids]


class _Session:
    def __init__(self, project_ids: list[UUID]) -> None:
        self.project_ids = project_ids
        self.added: list[object] = []
        self.executions: list[tuple[str, dict[str, object]]] = []
        self.flush_count = 0
        self.committed = False

    def add(self, row: object) -> None:
        self.added.append(row)

    def flush(self) -> None:
        self.flush_count += 1

    def execute(self, statement: object, params: dict[str, object]) -> _Result:
        self.executions.append((str(statement), dict(params)))
        return _Result(self.project_ids)

    def commit(self) -> None:
        self.committed = True


def test_create_request_prunes_to_latest_100_without_selecting_log_payloads(monkeypatch) -> None:
    user_id = uuid4()
    project_id = uuid4()
    other_project_id = uuid4()
    session = _Session([project_id, other_project_id, project_id])
    marked: list[tuple[UUID, UUID]] = []

    @contextmanager
    def _short_session():
        yield session

    monkeypatch.setattr(service_module, "short_session", _short_session)

    from App.backend.services import storage_usage_service

    monkeypatch.setattr(
        storage_usage_service,
        "mark_project_usage_for_reconcile",
        lambda _session, *, project_id, user_id: marked.append((project_id, user_id)),
    )

    service_module.LLMRequestService().create_request(
        request_id="request-101",
        user_id=user_id,
        project_id=project_id,
        thread_id=uuid4(),
        run_id=uuid4(),
        assistant_message_id=uuid4(),
        provider="custom",
        model="model",
    )

    assert len(session.added) == 1
    assert session.flush_count == 1
    assert session.committed is True
    assert len(session.executions) == 1

    sql, params = session.executions[0]
    normalized_sql = " ".join(sql.split()).lower()
    assert "row_number() over (order by created_at desc, id desc)" in normalized_sql
    assert "delete from llm_requests" in normalized_sql
    assert "raw_input" not in normalized_sql
    assert "raw_output" not in normalized_sql
    assert params == {"user_id": user_id, "max_rows": 100}
    assert set(marked) == {
        (project_id, user_id),
        (other_project_id, user_id),
    }


def test_prune_request_logs_ignores_non_uuid_result_rows() -> None:
    project_id = uuid4()
    session = _Session([project_id])

    original_execute = session.execute

    def _execute_with_invalid_row(statement: object, params: dict[str, object]):
        result = original_execute(statement, params)
        return SimpleNamespace(all=lambda: [*result.all(), ("not-a-uuid",)])

    session.execute = _execute_with_invalid_row  # type: ignore[method-assign]

    assert service_module._prune_request_logs(session, user_id=uuid4()) == {project_id}  # type: ignore[arg-type]

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Query

from App.backend.services.journey_service import JourneyService


class RecordingQuery:
    def __init__(
        self,
        entities: tuple[object, ...],
        *,
        result: object,
        statements: list[str],
    ) -> None:
        self._query = Query(entities)
        self._result = result
        self._statements = statements

    def filter(self, *criteria: object) -> "RecordingQuery":
        self._query = self._query.filter(*criteria)
        return self

    def order_by(self, *criteria: object) -> "RecordingQuery":
        self._query = self._query.order_by(*criteria)
        return self

    def group_by(self, *criteria: object) -> "RecordingQuery":
        self._query = self._query.group_by(*criteria)
        return self

    def _record(self) -> None:
        statement = self._query.statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": False},
        )
        self._statements.append(str(statement))

    def all(self) -> list[object]:
        self._record()
        return list(self._result)  # type: ignore[arg-type]

    def first(self) -> object | None:
        self._record()
        return self._result

    def scalar(self) -> object | None:
        self._record()
        return self._result

    def subquery(self):
        self._record()
        return self._query.subquery()


class RecordingSession:
    def __init__(self, results: list[object]) -> None:
        self._results = list(results)
        self.statements: list[str] = []

    def query(self, *entities: object) -> RecordingQuery:
        if not self._results:
            raise AssertionError("Unexpected query")
        return RecordingQuery(
            entities,
            result=self._results.pop(0),
            statements=self.statements,
        )


def _service() -> JourneyService:
    return JourneyService(
        db_factory=lambda: None,
        run_pipeline=SimpleNamespace(),
        event_dispatcher=SimpleNamespace(),
    )


def _assert_large_runtime_columns_omitted(statements: list[str]) -> None:
    sql = "\n".join(statements)
    assert "captured_prompt_snapshot" not in sql
    assert "input_payload" not in sql
    assert "mcp_request_json" not in sql
    assert "mcp_resolution_json" not in sql
    assert "context_object_ids" not in sql
    assert "journey_target_ids" not in sql


def test_list_project_journeys_projects_only_runtime_summary_columns() -> None:
    project_id = uuid4()
    user_id = uuid4()
    journey_id = uuid4()
    thread_id = uuid4()
    run_id = uuid4()
    updated_at = datetime(2026, 7, 12, 10, 30)
    latest_message_at = datetime(2026, 7, 12, 10, 31)

    db = RecordingSession(
        [
            [
                SimpleNamespace(
                    journey_id=journey_id,
                    project_id=project_id,
                    kind="objectTranslation",
                    display_label="Translate manuscript",
                    status="done",
                    last_error=None,
                    updated_at=updated_at,
                )
            ],
            [SimpleNamespace(thread_id=thread_id, journey_id=journey_id)],
            None,  # ranked-runs subquery
            [SimpleNamespace(run_id=run_id, thread_id=thread_id)],
            [SimpleNamespace(thread_id=thread_id, latest_message_at=latest_message_at)],
        ]
    )

    rows = _service().list_project_journeys(
        db,  # type: ignore[arg-type]
        project_id=project_id,
        user_id=user_id,
    )

    assert len(rows) == 1
    assert vars(rows[0]) == {
        "journey_id": journey_id,
        "project_id": project_id,
        "thread_id": thread_id,
        "latest_run_id": run_id,
        "latest_message_at": latest_message_at,
        "kind": "objectTranslation",
        "display_label": "Translate manuscript",
        "status": "done",
        "last_error": None,
        "updated_at": updated_at,
    }
    _assert_large_runtime_columns_omitted(db.statements)
    assert "row_number() OVER" in "\n".join(db.statements)


def test_get_owned_journey_runtime_uses_filtered_projection() -> None:
    project_id = uuid4()
    user_id = uuid4()
    journey_id = uuid4()
    thread_id = uuid4()
    run_id = uuid4()
    updated_at = datetime(2026, 7, 12, 11, 30)
    latest_message_at = datetime(2026, 7, 12, 11, 31)

    db = RecordingSession(
        [
            SimpleNamespace(
                journey_id=journey_id,
                project_id=project_id,
                kind="manuscriptEdit",
                display_label="Edit manuscript",
                status="running",
                last_error=None,
                updated_at=updated_at,
            ),
            SimpleNamespace(thread_id=thread_id),
            SimpleNamespace(run_id=run_id),
            latest_message_at,
        ]
    )

    row = _service().get_owned_journey_runtime(
        db,  # type: ignore[arg-type]
        journey_id=journey_id,
        user_id=user_id,
    )

    assert row.journey_id == journey_id
    assert row.project_id == project_id
    assert row.thread_id == thread_id
    assert row.latest_run_id == run_id
    assert row.latest_message_at == latest_message_at
    assert row.status == "running"
    assert len(db.statements) == 4
    _assert_large_runtime_columns_omitted(db.statements)

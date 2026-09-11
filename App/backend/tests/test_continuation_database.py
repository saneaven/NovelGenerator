"""Run against an isolated PostgreSQL database with TEST_DATABASE_URL.

Only model/provider execution is replaced; queue persistence, SQL constraints,
runtime task ownership and the resume lifecycle use the production code.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from App.backend.tests.run_pipeline_test_support import build_runtime_stack
from App.backend.models.db_models import (
    User, UserSettings, Project, Thread, RunModel, RunMessageModel,
    RunToolCallModel, RunContinuationModel,
)
from App.backend.services.continuation_service import ContinuationCoordinator
from App.backend.services.durable_run_event_bus import DurableRunEventBus

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is required")


@pytest.fixture(scope="module")
def database_engine():
    engine = create_engine(os.environ["TEST_DATABASE_URL"],
                           pool_size=int(os.getenv("TEST_DATABASE_POOL_SIZE", "4")), max_overflow=0)
    yield engine
    engine.dispose()


@pytest.fixture
def database(database_engine):
    engine = database_engine
    schema = "continuation_test_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = engine.execution_options(schema_translate_map={None: schema})
    User.metadata.create_all(scoped)
    factory = sessionmaker(bind=scoped, expire_on_commit=False)
    yield factory
    with engine.begin() as connection:
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def seed(factory, *, status="ready", tool_status="applied", name="read_manuscript", config=None):
    with factory() as db:
        user = User(id=uuid4(), email=f"{uuid4()}@test.invalid", username=uuid4().hex, password_hash="unused")
        db.add(user)
        db.flush()
        project = Project(id=uuid4(), user_id=user.id, name="Test")
        db.add(project)
        db.flush()
        thread = Thread(id=uuid4(), project_id=project.id, user_id=user.id, parent_id=uuid4(),
                        thread_type="agent", status=status)
        db.add(thread)
        db.flush()
        run = RunModel(id=uuid4(), thread_id=thread.id, user_id=user.id, project_id=project.id,
                       status=status, run_seq=1, language="English", next_message_seq=3)
        db.add(run)
        db.flush()
        message = RunMessageModel(id=uuid4(), thread_id=thread.id, run_id=run.id,
                                  role="assistant", seq=1, seq_in_thread=1, data={})
        db.add(message)
        db.flush()
        call = RunToolCallModel(id=uuid4(), thread_id=thread.id, run_id=run.id,
                               message_id=message.id, assistant_message_id=message.id,
                               call_seq=0, llm_call_id="call-1", tool_name=name, arguments={}, status=tool_status)
        job = RunContinuationModel(id=uuid4(), thread_id=thread.id, run_id=run.id, assistant_message_id=message.id)
        db.add_all([call, job, UserSettings(user_id=user.id, tool_call_auto_approve=config or {}, task_config_settings={})])
        db.commit()
        return SimpleNamespace(user=user.id, project=project.id, thread=thread.id, run=run.id,
                               message=message.id, call=call.id, job=job.id)


def coordinator(factory, calls):
    stack = build_runtime_stack(factory)

    async def execute(run_id, **_kwargs):
        calls.append(run_id)
        with factory() as db:
            run = db.get(RunModel, run_id)
            run.status = "done"
            run.thread.status = "done"
            db.add(RunMessageModel(thread_id=run.thread_id, run_id=run.id, role="assistant",
                                   seq=run.next_message_seq, seq_in_thread=run.next_message_seq,
                                   data={"English": {"contentParts": [{"type": "content", "text": "Finished"}]}}))
            db.commit()
    stack.lifecycle._execute_loop_fn = execute
    pipeline = SimpleNamespace(_runtime=stack.runtime, _thread_lock=stack.runtime.thread_lock,
                               _lifecycle=stack.lifecycle,
                               _apply_status_transition=stack.status_transitions.apply_status_transition)
    return ContinuationCoordinator(db_factory=factory, pipeline=pipeline)


def test_two_coordinators_continue_one_response_once_without_subscribers(database):
    ids = seed(database)
    calls = []
    first, second = coordinator(database, calls), coordinator(database, calls)

    async def run():
        await asyncio.gather(first.process(ids.job), second.process(ids.job))
        await first.process(ids.job)
    asyncio.run(run())
    assert calls == [ids.run]
    with database() as db:
        assert db.get(RunContinuationModel, ids.job).state == "done"


@pytest.mark.parametrize("status,tool_status,name", [
    ("paused", "applied", "read_manuscript"), ("canceled", "applied", "read_manuscript"),
    ("error", "applied", "read_manuscript"), ("waiting", "pending", "read_manuscript"),
    ("processing", "working", "call_writer"), ("done", "applied", "submit_image_prompt"),
])
def test_waits_and_stops_are_preserved(database, status, tool_status, name):
    ids = seed(database, status=status, tool_status=tool_status, name=name)
    calls = []
    asyncio.run(coordinator(database, calls).process(ids.job))
    assert calls == []


def test_auto_approval_then_continuation_survives_coordinator_recreation(database):
    ids = seed(database, status="waiting", tool_status="pending", config={"read": True})
    calls, approved = [], []
    first = coordinator(database, calls)

    async def apply(**kwargs):
        approved.extend(kwargs["tool_call_ids"])
        with database() as db:
            db.get(RunToolCallModel, ids.call).status = "applied"
            db.get(RunModel, ids.run).status = "ready"
            db.get(Thread, ids.thread).status = "ready"
            db.commit()
    first.apply_tools = apply
    asyncio.run(first.process(ids.job))
    asyncio.run(coordinator(database, calls).process(ids.job))
    assert approved == [ids.call]
    assert calls == [ids.run]


def test_pause_after_apply_prevents_next_generation(database):
    ids = seed(database, status="waiting", tool_status="pending", config={"read": True})
    calls = []
    worker = coordinator(database, calls)

    async def apply(**_kwargs):
        with database() as db:
            db.get(RunToolCallModel, ids.call).status = "applied"
            db.get(RunModel, ids.run).status = "paused"
            db.get(Thread, ids.thread).status = "paused"
            db.commit()
    worker.apply_tools = apply
    async def run():
        await worker.process(ids.job)
        await worker.process(ids.job)
    asyncio.run(run())
    assert calls == []


def test_abandoned_started_request_is_reported_without_replaying(database):
    ids = seed(database, status="running")
    with database() as db:
        job = db.get(RunContinuationModel, ids.job)
        job.state, job.owner = "started", uuid4()
        job.lease_until = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    calls = []
    asyncio.run(coordinator(database, calls).process(ids.job))
    assert calls == []
    with database() as db:
        assert db.get(RunModel, ids.run).status == "error"


def test_terminal_image_tool_is_approved_without_another_generation(database):
    ids = seed(database, status="waiting", tool_status="pending", name="submit_image_prompt", config={"write": True})
    calls, approvals = [], []
    worker = coordinator(database, calls)

    async def apply(**kwargs):
        approvals.extend(kwargs["tool_call_ids"])
        with database() as db:
            db.get(RunToolCallModel, ids.call).status = "applied"
            db.get(RunModel, ids.run).status = "done"
            db.commit()
    worker.apply_tools = apply
    async def run():
        await worker.process(ids.job)
        await worker.process(ids.job)
    asyncio.run(run())
    assert approvals == [ids.call]
    assert calls == []
    with database() as db:
        assert db.get(RunContinuationModel, ids.job).state == "done"


def test_abandoned_tool_is_resolved_as_unknown_without_automatic_retry(database):
    ids = seed(database, status="processing", tool_status="processing")
    with database() as db:
        db.get(RunContinuationModel, ids.job).state = "applying"
        db.commit()
    calls = []
    asyncio.run(coordinator(database, calls).process(ids.job))
    with database() as db:
        assert db.get(RunModel, ids.run).status == "error"
        assert db.get(RunToolCallModel, ids.call).status == "failed"
        assert db.get(RunToolCallModel, ids.call).result["outcome_unknown"] is True
    assert calls == []


def test_replays_more_than_128_events_after_bus_recreation(database):
    ids = seed(database)
    bus = DurableRunEventBus(database)
    for index in range(140):
        bus._persist(ids.user, {"event": "content:delta", "data": {"thread_id": str(ids.thread), "text": str(index)}})
    restored = DurableRunEventBus(database)
    _, rows = restored._read(ids.user, 0, "history")
    assert len(rows) == 140
    cursor = rows[99]["event_id"]
    _, tail = restored._read(ids.user, cursor, "history")
    assert [row["event"]["data"]["text"] for row in tail] == [str(i) for i in range(100, 140)]
    _, other_user = restored._read(uuid4(), 0, "history")
    assert other_user == []


def test_waits_for_previous_task_tail_before_resuming_same_run(database):
    ids = seed(database)
    calls = []
    worker = coordinator(database, calls)

    async def run():
        finishing = asyncio.Event()
        async def tail(_run_id, **_kwargs):
            await finishing.wait()
        await worker.pipeline._runtime.spawn_task(ids.run, execute_loop_fn=tail)
        await worker.process(ids.job)
        assert calls == []
        finishing.set()
        await worker.pipeline._runtime.wait_for_task(ids.run)
        await worker.process(ids.job)
    asyncio.run(run())
    assert calls == [ids.run]


def test_initial_subscription_captures_cursor_before_snapshot_hydration(database):
    ids = seed(database)
    bus = DurableRunEventBus(database)
    bus._persist(ids.user, {"event": "message:start", "data": {"thread_id": str(ids.thread), "message_id": ids.message}})
    cursor, rows = bus._read(ids.user, None, "latest")
    assert rows == [{"event_id": cursor, "event": {"event": "stream:reset", "data": {}}}]
    bus._persist(ids.user, {"event": "content:delta", "data": {"thread_id": str(ids.thread), "text": "during hydration"}})
    _, tail = bus._read(ids.user, cursor, "latest")
    assert tail[0]["event"]["data"]["text"] == "during hydration"


def test_migration_backfills_waiting_work_and_is_reversible(database):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    ids = seed(database, status="waiting", tool_status="pending")
    spec = importlib.util.spec_from_file_location("migration_0027", Path(__file__).parents[1] / "alembic/versions/0027_backend_continuations.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with database() as db:
        connection = db.connection()
        schema = connection.get_execution_options()["schema_translate_map"][None]
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            migration.downgrade()
            migration.upgrade()
        db.commit()
    with database() as db:
        job = db.query(RunContinuationModel).filter(RunContinuationModel.run_id == ids.run).one()
        assert job.assistant_message_id == ids.message
        assert job.state == "pending"

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from App.backend.tests.run_pipeline_test_support import (
    DeltaPayload,
    FakePersistSession,
    FallbackSnapshotAssembler,
    FinalToolCall,
    Thread,
    ToolOffer,
    RunModel,
    build_runtime_stack,
    invalid_result,
    valid_result,
)
from App.backend.services.run_pipeline import tool_call_persistence as persistence_module


def test_persist_tool_calls_uses_parsed_arguments_for_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakePersistSession()
    stack = build_runtime_stack(lambda: None)

    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="running",
        next_message_seq=1,
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
        next_message_seq=1,
    )
    assistant_message = persistence_module.RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={},
    )
    offer = ToolOffer(specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})
    seen_args: dict[str, object] = {}

    async def _validate_tool_call(*, args, **_kwargs):
        seen_args["value"] = args
        return valid_result()

    monkeypatch.setattr(persistence_module.tool_engine, "validate_tool_call", _validate_tool_call)
    monkeypatch.setattr(persistence_module, "apply_project_usage_deltas", lambda *_args, **_kwargs: None)

    tool_calls = [
        FinalToolCall(
            id="call_1",
            tool_name="call_character_planner",
            raw_arguments='{"input":"Create a profile"}',
            arguments={"input": "Create a profile"},
            parse_error=None,
        )
    ]

    rows = asyncio.run(
        stack.tool_call_persistence.persist_tool_calls(
            db,  # type: ignore[arg-type]
            thread=thread,
            run=run,
            assistant_message=assistant_message,
            tool_calls=tool_calls,
            offer=offer,
            preset_id=uuid4(),
        )
    )

    assert seen_args["value"] == {"input": "Create a profile"}
    assert rows[0].arguments == {"input": "Create a profile"}
    assert rows[0].status == "pending"
    assert any(event["event_name"] == "tool_call:end" for event in stack.dispatcher.events)


def test_persist_tool_calls_surfaces_parse_error_before_schema_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakePersistSession()
    stack = build_runtime_stack(lambda: None)

    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="running",
        next_message_seq=1,
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
        next_message_seq=1,
    )
    assistant_message = persistence_module.RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={},
    )
    offer = ToolOffer(specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})

    async def _validate_tool_call(**_kwargs):
        raise AssertionError("validate_tool_call should not run when parse_error exists")

    monkeypatch.setattr(persistence_module.tool_engine, "validate_tool_call", _validate_tool_call)
    monkeypatch.setattr(persistence_module, "apply_project_usage_deltas", lambda *_args, **_kwargs: None)

    tool_calls = [
        FinalToolCall(
            id="call_1",
            tool_name="call_character_planner",
            raw_arguments='"{\\"input\\":\\"bad\\"}"',
            arguments={},
            parse_error="Tool arguments JSON string did not decode to an object",
        )
    ]

    rows = asyncio.run(
        stack.tool_call_persistence.persist_tool_calls(
            db,  # type: ignore[arg-type]
            thread=thread,
            run=run,
            assistant_message=assistant_message,
            tool_calls=tool_calls,
            offer=offer,
            preset_id=uuid4(),
        )
    )

    assert rows[0].status == "failed"
    assert rows[0].reason == "[parse_tool_call_arguments] Tool arguments JSON string did not decode to an object"
    assert "Missing required parameter" not in str(rows[0].reason)


def test_persist_tool_calls_with_mixed_id_index_deltas_does_not_create_unknown_tool_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakePersistSession()
    stack = build_runtime_stack(lambda: None)

    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="running",
        next_message_seq=1,
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
        next_message_seq=1,
    )
    assistant_message = persistence_module.RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={},
    )
    offer = ToolOffer(specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})

    assembler = FallbackSnapshotAssembler(provider="test", model="test-model")
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "name": "create_story_entity",
                        "arguments": '{"name":"Elena"',
                    },
                }
            ]
        )
    )
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "function": {
                        "arguments": ',"type":"character"',
                    },
                }
            ]
        )
    )
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "arguments": ',"content":"Profile"}',
                    },
                }
            ]
        )
    )
    snapshot = assembler.finalize_or_raise()
    seen_tool_names: list[str] = []

    async def _validate_tool_call(*, tool_name, args, **_kwargs):
        seen_tool_names.append(str(tool_name))
        if not tool_name:
            return invalid_result("validate_tool_is_in_offer", "Tool not available in this session: ")
        if args.get("type") is None:
            return invalid_result(
                "validate_schema_required_enum_additional_properties",
                "Missing required parameter: type",
            )
        return valid_result()

    monkeypatch.setattr(persistence_module.tool_engine, "validate_tool_call", _validate_tool_call)
    monkeypatch.setattr(persistence_module, "apply_project_usage_deltas", lambda *_args, **_kwargs: None)

    rows = asyncio.run(
        stack.tool_call_persistence.persist_tool_calls(
            db,  # type: ignore[arg-type]
            thread=thread,
            run=run,
            assistant_message=assistant_message,
            tool_calls=snapshot.tool_calls,
            offer=offer,
            preset_id=uuid4(),
        )
    )

    assert len(snapshot.tool_calls) == 1
    assert seen_tool_names == ["create_story_entity"]
    assert len(rows) == 1
    assert rows[0].tool_name == "create_story_entity"
    assert rows[0].arguments == {
        "name": "Elena",
        "type": "character",
        "content": "Profile",
    }
    assert rows[0].status == "pending"
    assert rows[0].reason is None

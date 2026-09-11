from types import SimpleNamespace

import pytest

from App.backend.services.continuation_policy import auto_approval_ids, can_continue, tool_category
from App.backend.services.run_status_logic import derive_run_status


def tool(name="read_manuscript", status="applied", category=None):
    return SimpleNamespace(id=name, tool_name=name, status=status,
                           extra_content={"__tool_meta": {"category": category}} if category else None)


@pytest.mark.parametrize("status", ["waiting", "processing", "ready", "done"])
def test_resolved_tools_continue_without_a_browser(status):
    assert can_continue(status=status, tools=[tool(), tool("write", "failed")], unresolved=False)


@pytest.mark.parametrize("status", ["running", "paused", "canceled", "error"])
def test_active_or_explicitly_stopped_run_never_auto_resumes(status):
    assert not can_continue(status=status, tools=[tool()], unresolved=False)


@pytest.mark.parametrize("status", ["pending", "streaming", "validating", "processing", "working", "rejected"])
def test_unresolved_and_rejected_tools_block_continuation(status):
    assert not can_continue(status="ready", tools=[tool(status=status)], unresolved=False)


def test_terminal_image_prompt_and_plain_answer_end_the_turn():
    assert not can_continue(status="done", tools=[tool("submit_image_prompt")], unresolved=False)
    assert not can_continue(status="done", tools=[], unresolved=False)
    assert can_continue(status="ready", tools=[tool("generate_image")], unresolved=False)
    assert not can_continue(status="ready", tools=[tool()], unresolved=True)


def test_auto_approval_is_all_or_none_for_pending_tools():
    calls = [tool("read_manuscript", "pending"), tool("delete_entity", "pending"), tool("other", "failed")]
    assert auto_approval_ids(calls, {"read": True}) == []
    assert auto_approval_ids(calls, {"read": True, "delete": True}) == ["read_manuscript", "delete_entity"]
    assert auto_approval_ids(calls, {}) == []


def test_persisted_category_takes_precedence_over_name():
    assert tool_category(tool("read_something", category="mcp")) == "mcp"
    assert auto_approval_ids([tool("read_something", "pending", "mcp")], {"read": True}) == []


@pytest.mark.parametrize("status", ["paused", "canceled", "error"])
def test_late_tool_completion_cannot_clear_a_stop(status):
    assert derive_run_status(current_status=status, tool_call_statuses=["applied"]) == status

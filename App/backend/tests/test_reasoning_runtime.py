from __future__ import annotations

from App.backend.services.reasoning.history_filter import filter_history_by_run, get_completed_runs, pick_runs
from App.backend.services.reasoning.mode_policy import apply_thinking_mode
from App.backend.services.reasoning.normalize import normalize_reasoning_detail


def test_normalize_reasoning_detail_clamps_token_count() -> None:
    out = normalize_reasoning_detail(
        {
            "type": "openrouter",
            "meta": {"provider": "openrouter", "openrouter_reasoning_format": "foo"},
            "data": {"reasoning": "abc"},
            "token_count": -5,
            "ignored": True,
        }
    )

    assert out is not None
    assert out["type"] == "openrouter"
    assert out["meta"]["provider"] == "openrouter"
    assert out["token_count"] == 0
    assert "ignored" not in out


def test_get_completed_runs_excludes_current_run() -> None:
    messages = [
        {"role": "assistant", "run_id": "r1"},
        {"role": "assistant", "run_id": "r2"},
        {"role": "assistant", "run_id": "r3"},
    ]
    assert get_completed_runs(messages, "r3") == ["r1", "r2"]


def test_pick_runs_respects_limits() -> None:
    assert pick_runs(["r1", "r2", "r3"], 2) == {"r2", "r3"}
    assert pick_runs(["r1", "r2"], 0) == set()
    assert pick_runs(["r1", "r2"], -1) == {"r1", "r2"}


def test_filter_history_by_run_filters_tool_and_reasoning_per_run() -> None:
    messages = [
        {"role": "assistant", "run_id": "r1", "content_parts": [{"type": "thinking", "text": "t1"}], "reasoning_detail": {"a": 1}, "tool_calls": [{"id": "c1"}]},
        {"role": "tool_results", "run_id": "r1", "tool_results": [{"tool_call_id": "c1"}]},
        {"role": "assistant", "run_id": "r2", "content_parts": [{"type": "thinking", "text": "t2"}], "reasoning_detail": {"a": 2}, "tool_calls": [{"id": "c2"}]},
        {"role": "tool_results", "run_id": "r2", "tool_results": [{"tool_call_id": "c2"}]},
    ]

    out = filter_history_by_run(messages, current_run_id="r3", tool_limit=1, thinking_limit=1)
    assert len(out) == 3
    # r1 assistant survives but without reasoning/tool_calls
    assert out[0]["role"] == "assistant"
    assert out[0].get("reasoning_detail") is None
    assert out[0].get("tool_calls") is None
    # r1 tool_results removed
    assert out[1]["run_id"] == "r2"
    assert out[2]["role"] == "tool_results"


def test_apply_thinking_mode_custom_serializes_assistant() -> None:
    messages = [
        {
            "role": "assistant",
            "content_parts": [
                {"type": "thinking", "text": "thought"},
                {"type": "content", "text": "answer"},
            ],
            "reasoning_detail": {"x": 1},
        }
    ]

    out = apply_thinking_mode(messages, "custom")
    assert out[0]["content_parts"] == [{"type": "content", "text": "<thinking>thought</thinking>answer"}]
    assert "reasoning_detail" not in out[0]

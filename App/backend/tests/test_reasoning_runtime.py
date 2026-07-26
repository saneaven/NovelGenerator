from __future__ import annotations

import copy

from App.backend.providers.registry import list_specs
from App.backend.services.reasoning.history_filter import filter_history_by_run, get_completed_runs, pick_runs
from App.backend.services.reasoning.mode_policy import apply_thinking_mode
from App.backend.services.reasoning.normalize import normalize_reasoning_detail


def test_normalize_reasoning_detail_clamps_token_count() -> None:
    out = normalize_reasoning_detail(
        {
            "type": "openai_compatible_template",
            "meta": {
                "provider": "custom",
                "thinking_display": "reasoning_info.reasoning_text",
                "openrouter_reasoning_format": "foo",
            },
            "data": {"reasoning": "abc"},
            "token_count": -5,
            "ignored": True,
        }
    )

    assert out is not None
    assert out["type"] == "openai_compatible_template"
    assert out["meta"]["provider"] == "custom"
    assert out["meta"]["thinking_display"] == "reasoning_info.reasoning_text"
    assert out["token_count"] == 0
    assert "ignored" not in out


def test_normalize_reasoning_detail_allows_nanogpt_payload() -> None:
    out = normalize_reasoning_detail(
        {
            "type": "nanogpt",
            "meta": {
                "provider": "nanogpt",
                "thinking_display": "reasoning_text",
            },
            "data": {
                "reasoning_text": "checked the route",
                "reasoning_details": [{"format": "native", "text": "checked"}],
            },
            "token_count": 12,
        }
    )

    assert out is not None
    assert out["type"] == "nanogpt"
    assert out["meta"]["provider"] == "nanogpt"
    assert out["meta"]["thinking_display"] == "reasoning_text"
    assert out["data"]["reasoning_text"] == "checked the route"
    assert out["data"]["reasoning_details"] == [{"format": "native", "text": "checked"}]
    assert out["token_count"] == 12


def test_normalize_reasoning_detail_accepts_registered_llm_provider_ids() -> None:
    provider_ids = {spec.id for spec in list_specs() if spec.llm is not None}

    assert "ollama_cloud" in provider_ids
    for provider_id in provider_ids:
        out = normalize_reasoning_detail(
            {
                "type": provider_id,
                "meta": {"provider": provider_id},
                "data": {},
                "token_count": 0,
            }
        )

        assert out is not None
        assert out["type"] == provider_id
        assert out["meta"]["provider"] == provider_id


def test_normalize_reasoning_detail_rejects_image_only_provider_type_and_meta() -> None:
    assert normalize_reasoning_detail(
        {
            "type": "novelai",
            "meta": {"provider": "novelai"},
            "data": {},
            "token_count": 0,
        }
    ) is None

    out = normalize_reasoning_detail(
        {
            "type": "openai",
            "meta": {"provider": "novelai"},
            "data": {},
            "token_count": 0,
        }
    )

    assert out is not None
    assert "provider" not in out["meta"]


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


def test_filter_history_keeps_output_items_with_retained_tool_calls() -> None:
    output_items = [
        {
            "id": "rs_1",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "enc",
            "status": "completed",
        },
        {
            "id": "fc_1",
            "type": "function_call",
            "call_id": "call_1",
            "name": "tool",
            "arguments": "{}",
            "status": "completed",
        },
    ]
    messages = [
        {
            "role": "assistant",
            "run_id": "r1",
            "content_parts": [
                {"type": "thinking", "text": "old thought"},
                {"type": "content", "text": "old content"},
            ],
            "reasoning_detail": {
                "type": "openai",
                "meta": {
                    "provider": "openai",
                    "thinking_display": "reasoning_text",
                },
                "data": {
                    "output_items": output_items,
                    "reasoning_text": "old thought",
                },
                "token_count": 12,
            },
            "tool_calls": [{"id": "call_1"}],
        },
        {
            "role": "tool_results",
            "run_id": "r1",
            "tool_results": [{"tool_call_id": "call_1"}],
        },
        {
            "role": "assistant",
            "run_id": "r2",
            "content_parts": [{"type": "content", "text": "newer"}],
        },
    ]
    original = copy.deepcopy(messages)

    out = filter_history_by_run(
        messages,
        current_run_id="r3",
        tool_limit=2,
        thinking_limit=1,
    )

    assert messages == original
    assert out[0]["content_parts"] == [
        {"type": "content", "text": "old content"}
    ]
    assert out[0]["tool_calls"] == [{"id": "call_1"}]
    assert out[0]["reasoning_detail"] == {
        "type": "openai",
        "meta": {"provider": "openai"},
        "data": {"output_items": output_items},
        "token_count": 0,
    }
    assert out[1]["role"] == "tool_results"


def test_filter_history_removes_output_items_with_removed_tool_calls() -> None:
    messages = [
        {
            "role": "assistant",
            "run_id": "r1",
            "content_parts": [
                {"type": "thinking", "text": "old thought"},
                {"type": "content", "text": "old content"},
            ],
            "reasoning_detail": {
                "type": "openai",
                "meta": {
                    "provider": "openai",
                    "thinking_display": "reasoning_text",
                },
                "data": {
                    "items": [{"id": "rs_1", "type": "reasoning"}],
                    "output_items": [
                        {
                            "id": "fc_1",
                            "type": "function_call",
                            "call_id": "call_1",
                            "name": "tool",
                            "arguments": "{}",
                        }
                    ],
                    "reasoning_text": "old thought",
                },
                "token_count": 12,
            },
            "tool_calls": [{"id": "call_1"}],
        },
        {
            "role": "tool_results",
            "run_id": "r1",
            "tool_results": [{"tool_call_id": "call_1"}],
        },
        {
            "role": "assistant",
            "run_id": "r2",
            "content_parts": [{"type": "content", "text": "newer"}],
        },
    ]
    original = copy.deepcopy(messages)

    out = filter_history_by_run(
        messages,
        current_run_id="r3",
        tool_limit=1,
        thinking_limit=2,
    )

    assert messages == original
    assert [message["role"] for message in out] == ["assistant", "assistant"]
    assert "tool_calls" not in out[0]
    assert out[0]["reasoning_detail"]["data"] == {
        "items": [{"id": "rs_1", "type": "reasoning"}],
        "reasoning_text": "old thought",
    }
    assert out[0]["reasoning_detail"]["meta"]["thinking_display"] == "reasoning_text"


def test_filter_history_does_not_hide_invalid_output_items_from_provider_validation() -> None:
    messages = [
        {
            "role": "assistant",
            "run_id": "r1",
            "content_parts": [{"type": "thinking", "text": "old thought"}],
            "reasoning_detail": {
                "type": "openai",
                "meta": {"provider": "openai"},
                "data": {"output_items": None},
                "token_count": 0,
            },
        },
    ]

    out = filter_history_by_run(
        messages,
        current_run_id="r2",
        tool_limit=1,
        thinking_limit=0,
    )

    assert out[0]["reasoning_detail"]["data"] == {"output_items": None}


def test_filter_history_only_treats_openai_output_items_as_replay_state() -> None:
    custom_detail = {
        "type": "openai_compatible_template",
        "meta": {"provider": "custom"},
        "data": {"output_items": "custom template value"},
        "token_count": 0,
    }
    messages = [
        {
            "role": "assistant",
            "run_id": "r1",
            "content_parts": [{"type": "thinking", "text": "old thought"}],
            "reasoning_detail": custom_detail,
            "tool_calls": [{"id": "call_1"}],
        },
        {
            "role": "assistant",
            "run_id": "r2",
            "content_parts": [{"type": "content", "text": "newer"}],
        },
    ]

    reasoning_removed = filter_history_by_run(
        messages,
        current_run_id="r3",
        tool_limit=2,
        thinking_limit=1,
    )
    tool_removed = filter_history_by_run(
        messages,
        current_run_id="r3",
        tool_limit=1,
        thinking_limit=2,
    )

    assert "reasoning_detail" not in reasoning_removed[0]
    assert tool_removed[0]["reasoning_detail"] == custom_detail
    assert "tool_calls" not in tool_removed[0]


def test_apply_thinking_mode_custom_serializes_assistant() -> None:
    messages = [
        {
            "role": "assistant",
            "content_parts": [{"type": "content", "text": "answer"}],
            "reasoning_detail": {
                "meta": {"thinking_display": "reasoning_text"},
                "data": {"reasoning_text": "thought"},
            },
        }
    ]

    out = apply_thinking_mode(messages, "custom")
    assert out[0]["content_parts"] == [{"type": "content", "text": "<thinking>thought</thinking>answer"}]
    assert "reasoning_detail" not in out[0]

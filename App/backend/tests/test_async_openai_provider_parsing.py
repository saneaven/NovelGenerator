from __future__ import annotations

import sys
import types

if "openai" not in sys.modules:
    fake_openai = types.ModuleType("openai")

    class _StubOpenAIError(Exception):
        pass

    fake_openai.AsyncOpenAI = object
    fake_openai.OpenAIError = _StubOpenAIError
    fake_openai.APIConnectionError = _StubOpenAIError
    fake_openai.APIStatusError = _StubOpenAIError
    fake_openai.AuthenticationError = _StubOpenAIError
    fake_openai.BadRequestError = _StubOpenAIError
    fake_openai.RateLimitError = _StubOpenAIError
    sys.modules["openai"] = fake_openai

from App.backend.providers.async_openai_provider import AsyncOpenAIProvider
from App.backend.providers.fallback_snapshot_assembler import FallbackSnapshotAssembler
from App.backend.services.reasoning.provider_io import CustomOpenAICompletionIO


def test_chunk_to_events_extracts_reasoning_from_delta_thoughts() -> None:
    events = AsyncOpenAIProvider._chunk_to_events(
        {
            "choices": [
                {
                    "delta": {
                        "content": "answer",
                        "thoughts": [{"thought": "internal step"}],
                    }
                }
            ]
        }
    )

    assert len(events) == 1
    assert events[0].kind == "delta"
    delta = events[0].delta
    assert delta is not None
    assert delta.reasoning_detail_delta == [{"thought": True, "text": "internal step"}]


def test_chunk_to_events_falls_back_to_choice_thoughts_and_marks_thought_signature() -> None:
    events = AsyncOpenAIProvider._chunk_to_events(
        {
            "choices": [
                {
                    "delta": {"content": "answer"},
                    "thoughts": [{"thought_signature": "sig-1"}],
                }
            ]
        }
    )

    assert len(events) == 1
    assert events[0].kind == "delta"
    delta = events[0].delta
    assert delta is not None
    assert delta.reasoning_detail_delta == [{"thought_signature": "sig-1", "thought": True}]


def test_custom_openai_completion_non_template_ignores_reasoning_detail_items_without_text() -> None:
    assembler = FallbackSnapshotAssembler(provider="custom", model="gemini-3-flash-preview")
    events = AsyncOpenAIProvider._chunk_to_events(
        {
            "choices": [
                {
                    "delta": {
                        "content": "answer",
                        "thoughts": [{"thought": "step one"}],
                    }
                }
            ]
        }
    )
    for event in events:
        if event.kind == "delta" and event.delta is not None:
            assembler.apply_delta(event.delta)
        if event.kind == "meta" and event.meta is not None:
            assembler.apply_meta(event.meta)

    snapshot = assembler.finalize_or_raise()
    reasoning_detail = CustomOpenAICompletionIO().read_reasoning_detail(
        snapshot,
        {"custom_kind": "openai_completion"},
    )

    assert reasoning_detail is None


def test_accumulate_raw_chunk_keeps_multiple_tool_calls_separate() -> None:
    raw_accumulated: dict[str, object] = {}

    AsyncOpenAIProvider._accumulate_raw_chunk(
        raw_accumulated,
        {
            "choices": [
                {
                    "delta": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_basic",
                                "type": "function",
                                "function": {
                                    "name": "translate_basic_info",
                                    "arguments": '{"title":"A"}',
                                },
                            }
                        ],
                    }
                }
            ]
        },
    )
    AsyncOpenAIProvider._accumulate_raw_chunk(
        raw_accumulated,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 1,
                                "id": "call_guidelines",
                                "type": "function",
                                "function": {
                                    "name": "translate_guidelines",
                                    "arguments": '{"authorNote":"B"}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ]
        },
    )

    choices = raw_accumulated["choices"]
    assert isinstance(choices, list)
    choice = choices[0]
    assert isinstance(choice, dict)
    delta = choice["delta"]
    assert isinstance(delta, dict)
    tool_calls = delta["tool_calls"]
    assert isinstance(tool_calls, list)
    assert tool_calls == [
        {
            "index": 0,
            "id": "call_basic",
            "type": "function",
            "function": {
                "name": "translate_basic_info",
                "arguments": '{"title":"A"}',
            },
        },
        {
            "index": 1,
            "id": "call_guidelines",
            "type": "function",
            "function": {
                "name": "translate_guidelines",
                "arguments": '{"authorNote":"B"}',
            },
        },
    ]
    assert choice["finish_reason"] == "tool_calls"


def test_accumulate_raw_chunk_appends_arguments_for_same_tool_call() -> None:
    raw_accumulated: dict[str, object] = {}

    AsyncOpenAIProvider._accumulate_raw_chunk(
        raw_accumulated,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_character",
                                "type": "function",
                                "function": {
                                    "name": "translate_story_object",
                                    "arguments": '{"id":"char-1"',
                                },
                            }
                        ],
                    }
                }
            ]
        },
    )
    AsyncOpenAIProvider._accumulate_raw_chunk(
        raw_accumulated,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_character",
                                "type": "function",
                                "function": {
                                    "arguments": ',"type":"character"}',
                                },
                            }
                        ],
                    }
                }
            ]
        },
    )

    choices = raw_accumulated["choices"]
    assert isinstance(choices, list)
    choice = choices[0]
    assert isinstance(choice, dict)
    delta = choice["delta"]
    assert isinstance(delta, dict)
    tool_calls = delta["tool_calls"]
    assert isinstance(tool_calls, list)
    assert tool_calls == [
        {
            "index": 0,
            "id": "call_character",
            "type": "function",
            "function": {
                "name": "translate_story_object",
                "arguments": '{"id":"char-1","type":"character"}',
            },
        }
    ]

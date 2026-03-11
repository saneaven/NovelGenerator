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

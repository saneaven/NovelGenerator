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

if "anthropic" not in sys.modules:
    fake_anthropic = types.ModuleType("anthropic")
    fake_anthropic.AsyncAnthropic = object
    sys.modules["anthropic"] = fake_anthropic

if "httpx" not in sys.modules:
    fake_httpx = types.ModuleType("httpx")

    class _StubAsyncClient:
        pass

    class _StubHTTPStatusError(Exception):
        pass

    class _StubTimeout:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

    fake_httpx.AsyncClient = _StubAsyncClient
    fake_httpx.HTTPStatusError = _StubHTTPStatusError
    fake_httpx.Timeout = _StubTimeout
    sys.modules["httpx"] = fake_httpx

if "App.backend.database" not in sys.modules:
    from sqlalchemy.orm import declarative_base

    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

if "App.backend.models.db_models" not in sys.modules:
    fake_db_models = types.ModuleType("App.backend.models.db_models")

    class _StubRunMessageAttachmentModel:
        pass

    fake_db_models.RunMessageAttachmentModel = _StubRunMessageAttachmentModel
    sys.modules["App.backend.models.db_models"] = fake_db_models

if "App.backend.services.chat_attachment_service" not in sys.modules:
    fake_chat_attachment_service = types.ModuleType("App.backend.services.chat_attachment_service")
    fake_chat_attachment_service.chat_attachment_service = types.SimpleNamespace(
        load_attachment_bytes=lambda _storage_key: b"",
        to_data_url=lambda mime_type, _data: f"data:{mime_type};base64,",
    )
    sys.modules["App.backend.services.chat_attachment_service"] = fake_chat_attachment_service

from App.backend.providers.shared.async_openai_provider import AsyncOpenAIProvider
from App.backend.providers.custom.llm import CustomProvider
from App.backend.providers.nanogpt.llm import NanoGPTProvider
from App.backend.providers.shared.contracts import DeltaPayload, merge_openai_tool_call_deltas
from App.backend.providers.shared.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler
from App.backend.services.reasoning.normalize import normalize_reasoning_detail


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
    reasoning_detail = CustomProvider({}).read_reasoning_detail(
        snapshot,
        {"custom_kind": "openai_completion"},
    )

    assert reasoning_detail is None


def _normalized_nanogpt_reasoning_from_stream_chunk(
    chunk: dict[str, object],
    *,
    thinking_mode: str = "model",
) -> dict[str, object] | None:
    provider = NanoGPTProvider({})
    assembler = FallbackSnapshotAssembler(provider="nanogpt", model="test-model")

    chunk_obj, extra_chunks = provider._mutate_chunk(chunk, thinking_mode)
    chunks = ([chunk_obj] if chunk_obj is not None else []) + extra_chunks
    for item in chunks:
        if not provider._has_meaningful_payload(item):
            continue
        for event in provider._chunk_to_events(item):
            if event.kind == "delta" and event.delta is not None:
                assembler.apply_delta(event.delta)
            elif event.kind == "meta" and event.meta is not None:
                assembler.apply_meta(event.meta)

    snapshot = assembler.finalize_or_raise()
    return normalize_reasoning_detail(provider.read_reasoning_detail(snapshot, {"thinking_mode": "model"}))


def test_nanogpt_model_reasoning_delta_persists_as_reasoning_detail() -> None:
    reasoning_detail = _normalized_nanogpt_reasoning_from_stream_chunk(
        {
            "choices": [
                {
                    "delta": {
                        "reasoning": "checked route ",
                        "content": "answer",
                    }
                }
            ]
        }
    )

    assert reasoning_detail is not None
    assert reasoning_detail["type"] == "nanogpt"
    assert reasoning_detail["meta"] == {
        "provider": "nanogpt",
        "thinking_display": "reasoning_text",
    }
    assert reasoning_detail["data"]["reasoning_text"] == "checked route "


def test_nanogpt_model_reasoning_content_delta_persists_as_reasoning_detail() -> None:
    reasoning_detail = _normalized_nanogpt_reasoning_from_stream_chunk(
        {
            "choices": [
                {
                    "delta": {
                        "reasoning_content": "legacy checked route ",
                        "content": "answer",
                    }
                }
            ]
        }
    )

    assert reasoning_detail is not None
    assert reasoning_detail["type"] == "nanogpt"
    assert reasoning_detail["meta"]["provider"] == "nanogpt"
    assert reasoning_detail["meta"]["thinking_display"] == "reasoning_text"
    assert reasoning_detail["data"]["reasoning_text"] == "legacy checked route "


def test_nanogpt_reasoning_delta_ignored_when_thinking_mode_off() -> None:
    reasoning_detail = _normalized_nanogpt_reasoning_from_stream_chunk(
        {
            "choices": [
                {
                    "delta": {
                        "reasoning": "hidden route ",
                        "content": "answer",
                    }
                }
            ]
        },
        thinking_mode="off",
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
                                    "name": "translate_story_entity",
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
                "name": "translate_story_entity",
                "arguments": '{"id":"char-1","type":"character"}',
            },
        }
    ]


def test_accumulate_raw_chunk_keeps_id_only_tool_calls_separate() -> None:
    raw_accumulated: dict[str, object] = {}

    AsyncOpenAIProvider._accumulate_raw_chunk(
        raw_accumulated,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "id": "call_alpha",
                                "type": "function",
                                "function": {
                                    "name": "translate_story_entity",
                                    "arguments": '{"id":"alpha"}',
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
                                "id": "call_beta",
                                "type": "function",
                                "function": {
                                    "name": "translate_story_entity",
                                    "arguments": '{"id":"beta"}',
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
            "id": "call_alpha",
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"alpha"}',
            },
        },
        {
            "id": "call_beta",
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"beta"}',
            },
        },
    ]


def test_merge_openai_tool_call_deltas_does_not_merge_conflicting_ids_on_same_index() -> None:
    target = [
        {
            "index": 0,
            "id": "call_alpha",
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"alpha"}',
            },
        }
    ]
    source = [
        {
            "index": 0,
            "id": "call_beta",
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"beta"}',
            },
        }
    ]

    merge_openai_tool_call_deltas(target, source)

    assert target == [
        {
            "index": 0,
            "id": "call_alpha",
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"alpha"}',
            },
        },
        {
            "index": 0,
            "id": "call_beta",
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"beta"}',
            },
        },
    ]


def test_merge_openai_tool_call_deltas_keeps_anonymous_calls_separate() -> None:
    target = [
        {
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"alpha"}',
            },
        }
    ]
    source = [
        {
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"beta"}',
            },
        }
    ]

    merge_openai_tool_call_deltas(target, source)

    assert target == [
        {
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"alpha"}',
            },
        },
        {
            "type": "function",
            "function": {
                "name": "translate_story_entity",
                "arguments": '{"id":"beta"}',
            },
        },
    ]


def test_fallback_snapshot_assembler_uses_index_key_as_synthetic_id_when_provider_id_missing() -> None:
    assembler = FallbackSnapshotAssembler(provider="custom", model="gemini-3-flash-preview")
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "function": {
                        "name": "translate_story_entity",
                        "arguments": '{"id":"alpha"}',
                    },
                }
            ]
        )
    )

    snapshot = assembler.finalize_or_raise()

    assert len(snapshot.tool_calls) == 1
    assert snapshot.tool_calls[0].id == "index:0"
    assert snapshot.tool_calls[0].arguments == {"id": "alpha"}


def test_fallback_snapshot_assembler_keeps_anonymous_deltas_separate() -> None:
    assembler = FallbackSnapshotAssembler(provider="custom", model="gemini-3-flash-preview")
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "function": {
                        "name": "translate_story_entity",
                        "arguments": '{"id":"alpha"}',
                    },
                }
            ]
        )
    )
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "function": {
                        "name": "translate_story_entity",
                        "arguments": '{"id":"beta"}',
                    },
                }
            ]
        )
    )

    snapshot = assembler.finalize_or_raise()

    assert [tool_call.id for tool_call in snapshot.tool_calls] == ["anon:0", "anon:1"]
    assert [tool_call.arguments for tool_call in snapshot.tool_calls] == [
        {"id": "alpha"},
        {"id": "beta"},
    ]

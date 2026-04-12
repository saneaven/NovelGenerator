from __future__ import annotations

from App.backend.providers.content_normalization import (
    StreamContentNormalizer,
    has_effective_delta,
    normalize_final_snapshot_content,
)
from App.backend.providers.contracts import DeltaPayload, FinalSnapshot, extract_native_tool_calls_from_snapshot
from App.backend.providers.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler


def _snapshot(content_parts: list[dict[str, str]]) -> FinalSnapshot:
    return FinalSnapshot(
        provider="test",
        model="test-model",
        finish_reason="stop",
        content_parts=content_parts,
        tool_calls=[],
        reasoning_details=[],
        final_source="reducer_fallback",
    )


def test_stream_content_normalizer_trims_leading_whitespace_once() -> None:
    normalizer = StreamContentNormalizer()

    first = normalizer.normalize_delta(DeltaPayload(content_delta="  hello"))
    second = normalizer.normalize_delta(DeltaPayload(content_delta="  world"))

    assert first.content_delta == "hello"
    assert second.content_delta == "  world"


def test_stream_content_normalizer_discards_whitespace_only_prefix_but_keeps_side_data() -> None:
    normalizer = StreamContentNormalizer()

    whitespace_only = normalizer.normalize_delta(DeltaPayload(content_delta=" \n\t"))
    thinking_only = normalizer.normalize_delta(DeltaPayload(content_delta=" \n", thinking_delta="step"))
    content = normalizer.normalize_delta(DeltaPayload(content_delta="  hi"))

    assert whitespace_only.content_delta == ""
    assert not has_effective_delta(whitespace_only)

    assert thinking_only.content_delta == ""
    assert thinking_only.thinking_delta == "step"
    assert has_effective_delta(thinking_only)

    assert content.content_delta == "hi"


def test_normalize_final_snapshot_content_trims_edges_across_parts() -> None:
    snapshot = _snapshot(
        [
            {"type": "content", "text": "  he"},
            {"type": "thinking", "text": "inner"},
            {"type": "content", "text": "llo  "},
        ]
    )

    normalized = normalize_final_snapshot_content(snapshot)

    assert normalized.content_parts == [
        {"type": "content", "text": "he"},
        {"type": "thinking", "text": "inner"},
        {"type": "content", "text": "llo"},
    ]


def test_normalize_final_snapshot_content_removes_trimmed_edge_whitespace_parts() -> None:
    snapshot = _snapshot(
        [
            {"type": "content", "text": " \n"},
            {"type": "thinking", "text": "trace"},
            {"type": "content", "text": "  hi"},
            {"type": "content", "text": "  "},
        ]
    )

    normalized = normalize_final_snapshot_content(snapshot)

    assert normalized.content_parts == [
        {"type": "thinking", "text": "trace"},
        {"type": "content", "text": "hi"},
    ]


def test_fallback_snapshot_assembler_finalizes_whitespace_only_stream_to_empty_content() -> None:
    normalizer = StreamContentNormalizer()
    assembler = FallbackSnapshotAssembler(provider="test", model="test-model")

    assembler.apply_delta(normalizer.normalize_delta(DeltaPayload(content_delta=" \n\t")))

    snapshot = normalize_final_snapshot_content(assembler.finalize_or_raise())

    assert snapshot.content_parts == []
    assert snapshot.finish_reason == "stop"


def test_fallback_snapshot_assembler_reuses_id_key_for_later_index_only_delta() -> None:
    assembler = FallbackSnapshotAssembler(provider="test", model="test-model")

    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "name": "create_story_entity",
                        "arguments": '{"name":"Elena","type":"character"',
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
                        "arguments": ',"content":"Profile"}',
                    },
                }
            ]
        )
    )

    snapshot = assembler.finalize_or_raise()

    assert len(snapshot.tool_calls) == 1
    assert snapshot.tool_calls[0].id == "call_1"
    assert snapshot.tool_calls[0].tool_name == "create_story_entity"
    assert snapshot.tool_calls[0].arguments == {
        "name": "Elena",
        "type": "character",
        "content": "Profile",
    }


def test_fallback_snapshot_assembler_migrates_index_key_when_id_arrives_later() -> None:
    assembler = FallbackSnapshotAssembler(provider="test", model="test-model")

    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
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
                    "id": "call_1",
                    "function": {
                        "arguments": ',"type":"character","content":"Profile"}',
                    },
                }
            ]
        )
    )

    snapshot = assembler.finalize_or_raise()

    assert len(snapshot.tool_calls) == 1
    assert snapshot.tool_calls[0].id == "call_1"
    assert snapshot.tool_calls[0].tool_name == "create_story_entity"
    assert snapshot.tool_calls[0].arguments == {
        "name": "Elena",
        "type": "character",
        "content": "Profile",
    }


def test_fallback_snapshot_assembler_merges_mixed_id_index_fragments_without_empty_name_duplicate() -> None:
    assembler = FallbackSnapshotAssembler(provider="test", model="test-model")

    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "id": "call_1",
                    "extra_content": {"source": "initial"},
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
                    "extra_content": {"phase": "middle"},
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
                    "extra_content": {"final": True},
                    "function": {
                        "arguments": ',"content":"Profile"}',
                    },
                }
            ]
        )
    )

    snapshot = assembler.finalize_or_raise()

    assert len(snapshot.tool_calls) == 1
    assert all(tool_call.tool_name for tool_call in snapshot.tool_calls)
    assert snapshot.tool_calls[0].tool_name == "create_story_entity"
    assert snapshot.tool_calls[0].extra_content == {
        "source": "initial",
        "phase": "middle",
        "final": True,
    }
    assert snapshot.tool_calls[0].arguments == {
        "name": "Elena",
        "type": "character",
        "content": "Profile",
    }


def test_native_tool_call_extraction_happens_before_final_content_trim() -> None:
    snapshot = _snapshot(
        [
            {
                "type": "content",
                "text": '  hello<tool_call>{"tool":"search_story","query":"hero"}</tool_call>  ',
            }
        ]
    )

    extracted = extract_native_tool_calls_from_snapshot(snapshot)
    normalized = normalize_final_snapshot_content(extracted)

    assert normalized.content_parts == [{"type": "content", "text": "hello"}]
    assert len(normalized.tool_calls) == 1
    assert normalized.tool_calls[0].tool_name == "search_story"
    assert normalized.tool_calls[0].arguments == {"query": "hero"}

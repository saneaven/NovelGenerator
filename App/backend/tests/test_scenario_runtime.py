from __future__ import annotations

from App.backend.services.prompt_runtime.scenario_runtime import _group_by_run, _normalize_index, assemble_scenario
from App.backend.services.prompt_runtime.template_renderer import TemplateRenderer


def _msg(role: str, text: str, **extra: object) -> dict[str, object]:
    msg: dict[str, object] = {
        "role": role,
        "content_parts": [{"type": "content", "text": text}],
    }
    msg.update(extra)
    return msg


def _template_data() -> dict[str, object]:
    return {"input": {"userMessage": "", "agentMessage": "", "subAgentMessage": "", "toolResults": []}}


def test_normalize_index_handles_negative_and_bounds() -> None:
    assert _normalize_index(-1, 5) == 4
    assert _normalize_index(-5, 5) == 0
    assert _normalize_index(-6, 5) is None
    assert _normalize_index(0, 5) == 0
    assert _normalize_index(4, 5) == 4
    assert _normalize_index(5, 5) is None


def test_empty_range_is_skipped() -> None:
    renderer = TemplateRenderer(fragment_map={})
    system, convo, memory = assemble_scenario(
        template_renderer=renderer,
        task_type="agent",
        system_template="sys",
        blocks=[
            {
                "id": "b1",
                "block_order": 0,
                "enabled": True,
                "type": "rangeMapping",
                "rangeMapping": {
                    "start_index": 2,
                    "end_index": 1,  # empty (start > end)
                    "user_template": "U:{{input.userMessage}}",
                    "assistant_template": "A:{{input.agentMessage}}",
                },
            }
        ],
        source_conversation=[_msg("user", "hello")],
        template_data=_template_data(),
    )
    assert system == "sys"
    assert convo == []
    assert memory is None


def test_owner_overwrite_prefers_later_block() -> None:
    renderer = TemplateRenderer(fragment_map={})
    _, convo, _ = assemble_scenario(
        template_renderer=renderer,
        task_type="agent",
        system_template="",
        blocks=[
            {
                "id": "b1",
                "block_order": 0,
                "enabled": True,
                "type": "rangeMapping",
                "rangeMapping": {
                    "start_index": 0,
                    "end_index": -1,
                    "user_template": "A{{input.userMessage}}",
                    "assistant_template": "",
                },
            },
            {
                "id": "b2",
                "block_order": 1,
                "enabled": True,
                "type": "rangeMapping",
                "rangeMapping": {
                    "start_index": 1,
                    "end_index": 1,
                    "user_template": "B{{input.userMessage}}",
                    "assistant_template": "",
                },
            },
        ],
        source_conversation=[_msg("user", "m0"), _msg("user", "m1"), _msg("user", "m2")],
        template_data=_template_data(),
    )

    assert [m["role"] for m in convo] == ["user", "user", "user"]
    texts = [m["content_parts"][0]["text"] for m in convo]  # type: ignore[index]
    # Block 0 emits its owned items (0, 2) first, then block 1 emits item 1.
    assert texts == ["Am0", "Am2", "Bm1"]


def test_tool_results_attached_only_when_assistant_emitted() -> None:
    renderer = TemplateRenderer(fragment_map={})
    tool_calls = [{"id": "call_1", "type": "function", "function": {"name": "dummy", "arguments": "{}"}}]
    reasoning_detail = {"meta": {"provider": "custom"}, "data": {"reasoning_text": "x"}}
    source = [
        _msg("user", "u0"),
        _msg("assistant", "a0", tool_calls=tool_calls, reasoning_detail=reasoning_detail),
        _msg("tool_results", '{"ok":true}', tool_call_id="call_1"),
        _msg("user", "u1"),
    ]

    blocks_emit = [
        {
            "id": "b1",
            "block_order": 0,
            "enabled": True,
            "type": "rangeMapping",
            "rangeMapping": {
                "start_index": 0,
                "end_index": -1,
                "user_template": "{{input.userMessage}}",
                "assistant_template": "{{input.agentMessage}}",
            },
        }
    ]

    _, convo, _ = assemble_scenario(
        template_renderer=renderer,
        task_type="agent",
        system_template="",
        blocks=blocks_emit,
        source_conversation=source,
        template_data=_template_data(),
    )

    assert [m["role"] for m in convo] == ["user", "assistant", "tool_results", "user"]
    assert convo[1]["tool_calls"] == tool_calls
    assert convo[1]["reasoning_detail"] == reasoning_detail

    blocks_skip_assistant = [
        {
            "id": "b1",
            "block_order": 0,
            "enabled": True,
            "type": "rangeMapping",
            "rangeMapping": {
                "start_index": 0,
                "end_index": -1,
                "user_template": "{{input.userMessage}}",
                "assistant_template": "",  # metadata-only assistant should still survive
            },
        }
    ]
    _, convo2, _ = assemble_scenario(
        template_renderer=renderer,
        task_type="agent",
        system_template="",
        blocks=blocks_skip_assistant,
        source_conversation=source,
        template_data=_template_data(),
    )
    assert [m["role"] for m in convo2] == ["user", "assistant", "tool_results", "user"]
    assert convo2[1]["content_parts"] == []
    assert convo2[1]["tool_calls"] == tool_calls
    assert convo2[1]["reasoning_detail"] == reasoning_detail


def test_empty_assistant_without_metadata_is_skipped() -> None:
    renderer = TemplateRenderer(fragment_map={})
    source = [
        _msg("user", "u0"),
        _msg("assistant", "a0"),
        _msg("user", "u1"),
    ]
    blocks = [
        {
            "id": "b1",
            "block_order": 0,
            "enabled": True,
            "type": "rangeMapping",
            "rangeMapping": {
                "start_index": 0,
                "end_index": -1,
                "user_template": "{{input.userMessage}}",
                "assistant_template": "",
            },
        }
    ]

    _, convo, _ = assemble_scenario(
        template_renderer=renderer,
        task_type="agent",
        system_template="",
        blocks=blocks,
        source_conversation=source,
        template_data=_template_data(),
    )

    assert [m["role"] for m in convo] == ["user", "user"]


def test_subagent_range_mapping_patches_input_keys() -> None:
    renderer = TemplateRenderer(fragment_map={})
    blocks = [
        {
            "id": "b1",
            "block_order": 0,
            "enabled": True,
            "type": "rangeMapping",
            "rangeMapping": {
                "start_index": 0,
                "end_index": -1,
                "user_template": "U:{{input.agentMessage}}",
                "assistant_template": "A:{{input.subAgentMessage}}",
            },
        }
    ]

    _, convo, _ = assemble_scenario(
        template_renderer=renderer,
        task_type="subAgent",
        system_template="",
        blocks=blocks,
        source_conversation=[_msg("user", "hello"), _msg("assistant", "world")],
        template_data=_template_data(),
    )

    assert [m["role"] for m in convo] == ["user", "assistant"]
    assert convo[0]["content_parts"][0]["text"] == "U:hello"  # type: ignore[index]
    assert convo[1]["content_parts"][0]["text"] == "A:world"  # type: ignore[index]


def test_group_by_run_groups_consecutive_same_run_id() -> None:
    items = [
        {"message": {"role": "user", "run_id": "r1"}},
        {"message": {"role": "assistant", "run_id": "r1"}},
        {"message": {"role": "user", "run_id": "r2"}},
        {"message": {"role": "assistant", "run_id": "r2"}},
    ]
    runs = _group_by_run(items)
    assert len(runs) == 2
    assert len(runs[0]) == 2  # r1: user + assistant
    assert len(runs[1]) == 2  # r2: user + assistant


def test_group_by_run_none_run_id_standalone() -> None:
    items = [
        {"message": {"role": "user"}},
        {"message": {"role": "assistant"}},
        {"message": {"role": "user"}},
    ]
    runs = _group_by_run(items)
    assert len(runs) == 3  # each is standalone


def test_run_based_indexing_selects_entire_run() -> None:
    """Selecting run index 0 should emit all messages in that run."""
    renderer = TemplateRenderer(fragment_map={})
    source = [
        _msg("user", "u1", run_id="r1"),
        _msg("assistant", "a1", run_id="r1"),
        _msg("user", "u2", run_id="r2"),
        _msg("assistant", "a2", run_id="r2"),
    ]
    blocks = [
        {
            "id": "b1",
            "block_order": 0,
            "enabled": True,
            "type": "rangeMapping",
            "rangeMapping": {
                "start_index": 0,
                "end_index": 0,  # only first run
                "user_template": "{{input.userMessage}}",
                "assistant_template": "{{input.agentMessage}}",
            },
        }
    ]
    _, convo, _ = assemble_scenario(
        template_renderer=renderer,
        task_type="agent",
        system_template="",
        blocks=blocks,
        source_conversation=source,
        template_data=_template_data(),
    )
    assert [m["role"] for m in convo] == ["user", "assistant"]
    texts = [m["content_parts"][0]["text"] for m in convo]  # type: ignore[index]
    assert texts == ["u1", "a1"]


def test_run_based_negative_index_selects_last_run() -> None:
    renderer = TemplateRenderer(fragment_map={})
    source = [
        _msg("user", "u1", run_id="r1"),
        _msg("assistant", "a1", run_id="r1"),
        _msg("user", "u2", run_id="r2"),
        _msg("assistant", "a2", run_id="r2"),
    ]
    blocks = [
        {
            "id": "b1",
            "block_order": 0,
            "enabled": True,
            "type": "rangeMapping",
            "rangeMapping": {
                "start_index": -1,
                "end_index": -1,  # last run only
                "user_template": "{{input.userMessage}}",
                "assistant_template": "{{input.agentMessage}}",
            },
        }
    ]
    _, convo, _ = assemble_scenario(
        template_renderer=renderer,
        task_type="agent",
        system_template="",
        blocks=blocks,
        source_conversation=source,
        template_data=_template_data(),
    )
    assert [m["role"] for m in convo] == ["user", "assistant"]
    texts = [m["content_parts"][0]["text"] for m in convo]  # type: ignore[index]
    assert texts == ["u2", "a2"]


def test_run_based_owner_overwrite() -> None:
    """Block 1 overrides run 1, block 0 keeps runs 0 and 2."""
    renderer = TemplateRenderer(fragment_map={})
    source = [
        _msg("user", "u1", run_id="r1"),
        _msg("assistant", "a1", run_id="r1"),
        _msg("user", "u2", run_id="r2"),
        _msg("assistant", "a2", run_id="r2"),
        _msg("user", "u3", run_id="r3"),
        _msg("assistant", "a3", run_id="r3"),
    ]
    blocks = [
        {
            "id": "b1",
            "block_order": 0,
            "enabled": True,
            "type": "rangeMapping",
            "rangeMapping": {
                "start_index": 0,
                "end_index": -1,
                "user_template": "A:{{input.userMessage}}",
                "assistant_template": "A:{{input.agentMessage}}",
            },
        },
        {
            "id": "b2",
            "block_order": 1,
            "enabled": True,
            "type": "rangeMapping",
            "rangeMapping": {
                "start_index": 1,
                "end_index": 1,  # override run index 1 (r2)
                "user_template": "B:{{input.userMessage}}",
                "assistant_template": "B:{{input.agentMessage}}",
            },
        },
    ]
    _, convo, _ = assemble_scenario(
        template_renderer=renderer,
        task_type="agent",
        system_template="",
        blocks=blocks,
        source_conversation=source,
        template_data=_template_data(),
    )
    texts = [m["content_parts"][0]["text"] for m in convo if m["role"] in {"user", "assistant"}]  # type: ignore[index]
    # Block 0 emits its owned runs (0, 2) first, then block 1 emits run 1.
    assert texts == ["A:u1", "A:a1", "A:u3", "A:a3", "B:u2", "B:a2"]


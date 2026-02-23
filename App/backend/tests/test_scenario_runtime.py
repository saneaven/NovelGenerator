from __future__ import annotations

from App.backend.services.prompt_runtime.scenario_runtime import _normalize_index, assemble_scenario
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
    assert texts == ["Am0", "Bm1", "Am2"]


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
                "assistant_template": "",  # assistant render empty -> skip
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
    assert [m["role"] for m in convo2] == ["user", "user"]
    assert all(m["role"] != "tool_results" for m in convo2)


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


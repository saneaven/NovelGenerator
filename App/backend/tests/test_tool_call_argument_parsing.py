from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from App.backend.providers.shared.parsing.tool_call_arguments import parse_tool_call_arguments


def test_parse_tool_call_arguments_preserves_dict_input() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments({"input": "hello"})

    assert raw_text == '{"input":"hello"}'
    assert args == {"input": "hello"}
    assert parse_error is None


def test_parse_tool_call_arguments_parses_json_object_string() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments('{"input":"hello"}')

    assert raw_text == '{"input":"hello"}'
    assert args == {"input": "hello"}
    assert parse_error is None


def test_parse_tool_call_arguments_unwraps_double_encoded_json_string() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments('"{\\"input\\":\\"hello\\"}"')

    assert raw_text == '{"input":"hello"}'
    assert args == {"input": "hello"}
    assert parse_error is None


def test_parse_tool_call_arguments_reports_malformed_json() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments('{"input":')

    assert raw_text == '{"input":'
    assert args == {}
    assert parse_error is not None


def test_parse_tool_call_arguments_rejects_non_object_json() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments('["hello"]')

    assert raw_text == '["hello"]'
    assert args == {}
    assert parse_error == "Tool arguments JSON is not an object"


def test_parse_tool_call_arguments_decodes_html_entities_in_string_values() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments('{"content":"A &lt;tag&gt; &amp; B"}')

    assert raw_text == '{"content":"A <tag> & B"}'
    assert args == {"content": "A <tag> & B"}
    assert parse_error is None


def test_parse_tool_call_arguments_decodes_nested_html_entity_values() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments(
        '{"items":["A &lt;one&gt;",{"content":"B &amp; C"}],"count":2}'
    )

    assert raw_text == '{"items":["A <one>",{"content":"B & C"}],"count":2}'
    assert args == {"items": ["A <one>", {"content": "B & C"}], "count": 2}
    assert parse_error is None


def test_parse_tool_call_arguments_decodes_dict_input_values() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments({"content": "A &lt;tag&gt;"})

    assert raw_text == '{"content":"A <tag>"}'
    assert args == {"content": "A <tag>"}
    assert parse_error is None


def test_parse_tool_call_arguments_does_not_decode_keys() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments('{"field&lt;name&gt;":"A &lt;tag&gt;"}')

    assert raw_text == '{"field&lt;name&gt;":"A <tag>"}'
    assert args == {"field&lt;name&gt;": "A <tag>"}
    assert parse_error is None


def test_parse_tool_call_arguments_does_not_decode_json_syntax() -> None:
    raw_text, args, parse_error = parse_tool_call_arguments('{&quot;content&quot;:&quot;x&quot;}')

    assert raw_text == '{&quot;content&quot;:&quot;x&quot;}'
    assert args == {}
    assert parse_error is not None

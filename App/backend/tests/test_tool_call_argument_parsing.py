from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from App.backend.providers.tool_call_arguments import parse_tool_call_arguments


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

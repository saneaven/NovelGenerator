from __future__ import annotations

import pytest

from App.backend.utils.template_vars import resolve_and_filter_headers, resolve_str, resolve_value


class TestResolveStr:
    def test_simple_variable(self):
        assert resolve_str("{{ name }}", {"name": "alice"}) == "alice"

    def test_multiple_variables(self):
        assert resolve_str("{{ a }}-{{ b }}", {"a": "x", "b": "y"}) == "x-y"

    def test_inline_if_true(self):
        assert resolve_str("{{ 'yes' if flag else 'no' }}", {"flag": True}) == "yes"

    def test_inline_if_false(self):
        assert resolve_str("{{ 'yes' if flag else 'no' }}", {"flag": False}) == "no"

    def test_unknown_variable_empty(self):
        assert resolve_str("{{ unknown }}", {}) == ""

    def test_no_template_passthrough(self):
        assert resolve_str("plain text", {}) == "plain text"

    def test_malformed_template_returns_original(self):
        # Jinja2 sandbox catches the error; resolve_str returns the original value
        result = resolve_str("{{ foo | nonexistent_filter }}", {})
        assert result == "{{ foo | nonexistent_filter }}"

    def test_bool_to_string(self):
        assert resolve_str("{{ val }}", {"val": True}) == "True"

    def test_empty_context(self):
        assert resolve_str("prefix-{{ x }}-suffix", {}) == "prefix--suffix"


class TestResolveValue:
    def test_string(self):
        assert resolve_value("{{ x }}", {"x": "hello"}) == "hello"

    def test_dict(self):
        data = {"key": "{{ x }}", "static": "no-template"}
        result = resolve_value(data, {"x": "resolved"})
        assert result == {"key": "resolved", "static": "no-template"}

    def test_nested_dict(self):
        data = {"outer": {"inner": "{{ v }}"}}
        assert resolve_value(data, {"v": "deep"}) == {"outer": {"inner": "deep"}}

    def test_list(self):
        data = ["{{ a }}", "{{ b }}", "static"]
        assert resolve_value(data, {"a": "1", "b": "2"}) == ["1", "2", "static"]

    def test_list_in_dict(self):
        data = {"items": ["{{ x }}", "plain"]}
        assert resolve_value(data, {"x": "val"}) == {"items": ["val", "plain"]}

    def test_non_string_passthrough(self):
        data = {"num": 42, "flag": True, "none": None, "text": "{{ x }}"}
        result = resolve_value(data, {"x": "ok"})
        assert result == {"num": 42, "flag": True, "none": None, "text": "ok"}

    def test_empty_dict(self):
        assert resolve_value({}, {"x": "y"}) == {}

    def test_empty_list(self):
        assert resolve_value([], {"x": "y"}) == []

    def test_returns_new_dict(self):
        original = {"k": "{{ v }}"}
        result = resolve_value(original, {"v": "resolved"})
        assert original["k"] == "{{ v }}"
        assert result["k"] == "resolved"


class TestResolveAndFilterHeaders:
    def test_static_headers_pass_through(self):
        headers = {"X-Api-Version": "2024-01", "X-Custom": "value"}
        assert resolve_and_filter_headers(headers) == {"X-Api-Version": "2024-01", "X-Custom": "value"}

    def test_template_headers_resolved_with_context(self):
        headers = {"X-Run": "{{ run_id }}", "X-Static": "plain"}
        result = resolve_and_filter_headers(headers, {"run_id": "abc-123"})
        assert result == {"X-Run": "abc-123", "X-Static": "plain"}

    def test_template_headers_filtered_when_empty(self):
        headers = {"X-Run": "{{ run_id }}", "X-Thread": "{{ thread_id }}", "X-Static": "plain"}
        result = resolve_and_filter_headers(headers)
        assert result == {"X-Static": "plain"}

    def test_all_template_headers_filtered(self):
        headers = {"X-Run": "{{ run_id }}", "X-Thread": "{{ thread_id }}"}
        assert resolve_and_filter_headers(headers) == {}

    def test_empty_input(self):
        assert resolve_and_filter_headers({}) == {}
        assert resolve_and_filter_headers(None) == {}

    def test_whitespace_only_values_filtered(self):
        headers = {"X-Run": "  ", "X-Static": "value"}
        assert resolve_and_filter_headers(headers) == {"X-Static": "value"}

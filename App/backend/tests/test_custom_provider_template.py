"""Integration tests for custom provider template variable resolution across all 3 request paths."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest

from App.backend.providers.custom import CustomProvider, _CustomClaudeProvider, _CustomOpenAIResponseProvider, build_request_context


def _base_config(**overrides) -> dict:
    cfg = {
        "api_key": "test-key",
        "base_url": "https://example.com",
        "custom_kind": "openai_completion",
        "additional_headers": {"X-Static": "plain", "X-Run": "{{ run_id }}"},
        "additional_body": {"custom_field": "{{ thread_type }}", "nested": {"val": "{{ model }}"}},
    }
    cfg.update(overrides)
    return cfg


_CTX = {
    "run_id": "aaa-bbb",
    "thread_id": "ccc-ddd",
    "thread_type": "subAgent",
    "is_sub_agent": True,
    "parent_run_id": "eee-fff",
    "last_role": "user",
    "model": "gpt-4o",
    "run_seq": "5",
}


class TestCompletionPath:
    """CustomProvider (openai_completion) — _prepare_request_kwargs."""

    def test_extra_headers_added_when_context_set(self):
        provider = CustomProvider(_base_config())
        provider.set_request_context(_CTX)
        request = provider._prepare_request_kwargs(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-4o",
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            provider_preference=None,
            thinking_config=None,
        )
        assert request["extra_headers"] == {"X-Static": "plain", "X-Run": "aaa-bbb"}

    def test_body_resolved_when_context_set(self):
        provider = CustomProvider(_base_config())
        provider.set_request_context(_CTX)
        request = provider._prepare_request_kwargs(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-4o",
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            provider_preference=None,
            thinking_config=None,
        )
        extra_body = request.get("extra_body", {})
        assert extra_body["custom_field"] == "subAgent"
        assert extra_body["nested"]["val"] == "gpt-4o"

    def test_no_extra_headers_without_context(self):
        provider = CustomProvider(_base_config())
        request = provider._prepare_request_kwargs(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-4o",
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            provider_preference=None,
            thinking_config=None,
        )
        assert "extra_headers" not in request

    def test_raw_body_without_context(self):
        provider = CustomProvider(_base_config())
        request = provider._prepare_request_kwargs(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-4o",
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            provider_preference=None,
            thinking_config=None,
        )
        extra_body = request.get("extra_body", {})
        assert extra_body["custom_field"] == "{{ thread_type }}"

    def test_no_template_headers_no_extra_headers(self):
        """When headers have no templates and context is set, extra_headers still includes resolved values."""
        config = _base_config(additional_headers={"X-Static": "plain"})
        provider = CustomProvider(config)
        provider.set_request_context(_CTX)
        request = provider._prepare_request_kwargs(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-4o",
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            provider_preference=None,
            thinking_config=None,
        )
        assert request["extra_headers"] == {"X-Static": "plain"}


class TestClaudeDelegatePath:
    """_CustomClaudeProvider — _additional_request_body + _get_extra_headers."""

    def test_resolved_body_propagated(self):
        provider = CustomProvider(_base_config(custom_kind="claude"))
        provider.set_request_context(_CTX)
        delegate = provider._build_claude_delegate()
        body = delegate._additional_request_body()
        assert body["custom_field"] == "subAgent"
        assert body["nested"]["val"] == "gpt-4o"

    def test_resolved_headers_propagated(self):
        provider = CustomProvider(_base_config(custom_kind="claude"))
        provider.set_request_context(_CTX)
        delegate = provider._build_claude_delegate()
        assert delegate._get_extra_headers() == {"X-Static": "plain", "X-Run": "aaa-bbb"}

    def test_no_context_raw_body(self):
        provider = CustomProvider(_base_config(custom_kind="claude"))
        delegate = provider._build_claude_delegate()
        body = delegate._additional_request_body()
        assert body["custom_field"] == "{{ thread_type }}"

    def test_no_context_empty_extra_headers(self):
        provider = CustomProvider(_base_config(custom_kind="claude"))
        delegate = provider._build_claude_delegate()
        assert delegate._get_extra_headers() == {}


class TestResponsesDelegatePath:
    """_CustomOpenAIResponseProvider — _prepare_responses_request."""

    def test_resolved_body_and_headers(self):
        provider = CustomProvider(_base_config(custom_kind="openai_response"))
        provider.set_request_context(_CTX)
        delegate = provider._build_openai_response_delegate()
        request = delegate._prepare_responses_request(
            model="gpt-4o",
            input_items=[],
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            thinking_config=None,
            verbosity=None,
        )
        assert request.get("extra_headers") == {"X-Static": "plain", "X-Run": "aaa-bbb"}
        extra_body = request.get("extra_body", {})
        assert extra_body["custom_field"] == "subAgent"

    def test_no_context_no_extra_headers(self):
        provider = CustomProvider(_base_config(custom_kind="openai_response"))
        delegate = provider._build_openai_response_delegate()
        request = delegate._prepare_responses_request(
            model="gpt-4o",
            input_items=[],
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            thinking_config=None,
            verbosity=None,
        )
        assert "extra_headers" not in request


class TestListBody:
    """Verify list values in additional_body are resolved correctly."""

    def test_list_items_resolved(self):
        config = _base_config(additional_body={"tags": ["{{ run_id }}", "static", "{{ model }}"]})
        provider = CustomProvider(config)
        provider.set_request_context(_CTX)
        request = provider._prepare_request_kwargs(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-4o",
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            provider_preference=None,
            thinking_config=None,
        )
        extra_body = request.get("extra_body", {})
        assert extra_body["tags"] == ["aaa-bbb", "static", "gpt-4o"]


class TestBuildRequestContext:
    def _make_run(self, **overrides):
        defaults = {"id": UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), "parent_run_id": None, "run_seq": 3}
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def _make_thread(self, **overrides):
        defaults = {"id": UUID("11111111-2222-3333-4444-555555555555"), "thread_type": "agent"}
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def _make_task_config(self, **overrides):
        defaults = {"model": "gpt-4o"}
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def test_basic_context(self):
        ctx = build_request_context(
            run=self._make_run(),
            thread=self._make_thread(),
            provider_messages=[{"role": "user", "content": "hi"}],
            task_config=self._make_task_config(),
        )
        assert ctx["run_id"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        assert ctx["thread_id"] == "11111111-2222-3333-4444-555555555555"
        assert ctx["thread_type"] == "agent"
        assert ctx["is_sub_agent"] is False
        assert ctx["parent_run_id"] == ""
        assert ctx["last_role"] == "user"
        assert ctx["model"] == "gpt-4o"
        assert ctx["run_seq"] == "3"

    def test_sub_agent(self):
        ctx = build_request_context(
            run=self._make_run(parent_run_id=UUID("99999999-0000-0000-0000-000000000000")),
            thread=self._make_thread(thread_type="subAgent"),
            provider_messages=[],
            task_config=self._make_task_config(),
        )
        assert ctx["is_sub_agent"] is True
        assert ctx["parent_run_id"] == "99999999-0000-0000-0000-000000000000"
        assert ctx["thread_type"] == "subAgent"

    def test_last_role_assistant(self):
        messages = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
        ctx = build_request_context(
            run=self._make_run(), thread=self._make_thread(),
            provider_messages=messages, task_config=self._make_task_config(),
        )
        assert ctx["last_role"] == "assistant"

    def test_last_role_skips_system(self):
        messages = [{"role": "user", "content": "hi"}, {"role": "system", "content": "prompt"}]
        ctx = build_request_context(
            run=self._make_run(), thread=self._make_thread(),
            provider_messages=messages, task_config=self._make_task_config(),
        )
        assert ctx["last_role"] == "user"

    def test_empty_messages(self):
        ctx = build_request_context(
            run=self._make_run(), thread=self._make_thread(),
            provider_messages=[], task_config=self._make_task_config(),
        )
        assert ctx["last_role"] == ""

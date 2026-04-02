from __future__ import annotations

from App.backend.providers.request_logging import build_logged_request_body


def test_build_logged_request_body_strips_headers_and_merges_extra_body() -> None:
    logged = build_logged_request_body(
        {
            "model": "gpt-4.1",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
            "extra_headers": {"Authorization": "secret", "X-Test": "1"},
            "extra_body": {
                "metadata": {"request_id": "req_123"},
                "messages": [{"role": "user", "content": "override"}],
            },
            "extra_query": {"api-version": "2025-01-01"},
        }
    )

    assert "extra_headers" not in logged
    assert "extra_query" not in logged
    assert "extra_body" not in logged
    assert logged["metadata"] == {"request_id": "req_123"}
    assert logged["messages"] == [{"role": "user", "content": "override"}]


def test_build_logged_request_body_keeps_plain_body_intact() -> None:
    request = {
        "model": "claude-sonnet",
        "messages": [{"role": "user", "content": "hello"}],
        "temperature": 0.7,
    }

    logged = build_logged_request_body(request)

    assert logged == request

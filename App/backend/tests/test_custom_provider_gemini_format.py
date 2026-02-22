from __future__ import annotations

import pytest

from App.backend.providers.custom import CustomProvider


def _build_provider_for_request_prep() -> CustomProvider:
    provider = object.__new__(CustomProvider)
    provider._additional_body = {}
    return provider


def test_custom_gemini_thinking_config_is_wrapped_in_extra_body_envelope() -> None:
    provider = _build_provider_for_request_prep()

    request = provider._prepare_request_kwargs(
        messages=[{"role": "user", "content": "hi"}],
        model="gemini-3-flash-preview",
        temperature=0.7,
        tools=None,
        tool_choice=None,
        max_tokens=None,
        provider_preference=None,
        thinking_config={"gemini_thinking_level": "low"},
        thinking_format="gemini",
    )

    extra_body = request.get("extra_body")
    assert isinstance(extra_body, dict)
    wrapped_extra_body = extra_body.get("extra_body")
    assert isinstance(wrapped_extra_body, dict)
    google = wrapped_extra_body.get("google")
    assert isinstance(google, dict)
    thinking_config = google.get("thinking_config")
    assert isinstance(thinking_config, dict)
    assert thinking_config.get("include_thoughts") is True
    assert thinking_config.get("thinking_level") == "low"
    assert "google" not in extra_body


def test_custom_gemini_rejects_effort_and_google_thinking_config_together() -> None:
    provider = _build_provider_for_request_prep()

    with pytest.raises(ValueError, match="requires choosing either reasoning_effort"):
        provider._prepare_request_kwargs(
            messages=[{"role": "user", "content": "hi"}],
            model="gemini-3-flash-preview",
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            provider_preference=None,
            thinking_config={"effort": "low", "gemini_thinking_level": "high"},
            thinking_format="gemini",
        )

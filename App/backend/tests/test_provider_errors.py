from __future__ import annotations

import pytest

from App.backend.providers.shared.errors import provider_error_fields


@pytest.mark.parametrize(
    ("attributes", "expected_status"),
    [
        ({"status_code": 429, "status": "RESOURCE_EXHAUSTED", "code": 503}, 429),
        ({"status": 503, "code": 429}, 503),
        ({"status": "RESOURCE_EXHAUSTED", "code": 429}, 429),
        ({"status_code": "unknown", "status": 502}, 502),
        ({"status": "UNAVAILABLE", "code": 503}, 503),
        ({"status": "RESOURCE_EXHAUSTED"}, None),
        ({}, None),
    ],
)
def test_provider_error_fields_preserves_numeric_status(attributes, expected_status) -> None:
    exc = RuntimeError("Provider request failed")
    for name, value in attributes.items():
        setattr(exc, name, value)

    message, status, retryable = provider_error_fields(exc)

    assert message == "Provider request failed"
    assert status == expected_status
    assert retryable is False

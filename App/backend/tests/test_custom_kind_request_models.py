from __future__ import annotations

import pytest
from pydantic import ValidationError

from App.backend.models.requests import ChatCompletionRequest, ProviderModelsRequest


def test_chat_completion_request_defaults_custom_kind() -> None:
    request = ChatCompletionRequest(
        messages=[],
        model="gateway-model",
    )

    assert request.custom_kind == "openai_completion"


def test_provider_models_request_defaults_custom_kind() -> None:
    request = ProviderModelsRequest()

    assert request.custom_kind == "openai_completion"


def test_chat_completion_request_rejects_legacy_request_format() -> None:
    with pytest.raises(ValidationError, match="request_format"):
        ChatCompletionRequest.model_validate(
            {
                "messages": [],
                "model": "gateway-model",
                "request_format": "openai_sdk",
            }
        )


def test_provider_models_request_rejects_legacy_request_format() -> None:
    with pytest.raises(ValidationError, match="request_format"):
        ProviderModelsRequest.model_validate({"request_format": "openai_sdk"})

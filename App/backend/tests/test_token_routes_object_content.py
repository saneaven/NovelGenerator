from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import ANY
from uuid import uuid4

import pytest
from fastapi import HTTPException

from App.backend.routes import token_routes


def _token_result(token_count: int, *, provider: str = "openrouter", model: str = "model"):
    return SimpleNamespace(
        token_count=token_count,
        provider=provider,
        model=model,
        effective_tokenizer="openai",
        is_estimate=True,
        fallback_used=False,
        method="tiktoken",
    )


def test_count_object_content_tokens_counts_backend_object_text(monkeypatch: pytest.MonkeyPatch) -> None:
    project_id = uuid4()
    user_id = uuid4()
    object_id = uuid4()
    captured: dict[str, object] = {}

    def fake_build_text(db, **kwargs):
        captured["build_kwargs"] = {"db": db, **kwargs}
        return "Content: selected object body"

    async def fake_count_text_tokens(*_args, **kwargs):
        captured["count_kwargs"] = kwargs
        return _token_result(29, provider=str(kwargs["provider"]), model=str(kwargs["model"]))

    monkeypatch.setattr(token_routes, "build_selected_object_token_text", fake_build_text)
    monkeypatch.setattr(token_routes, "count_text_tokens", fake_count_text_tokens)

    response = asyncio.run(
        token_routes.count_object_content_tokens(
            token_routes.CountObjectContentTokensRequest(
                project_id=project_id,
                language="English",
                object_ids=[object_id],
                provider="openrouter",
                model="test-model",
            ),
            current_user=SimpleNamespace(id=user_id),
            db=SimpleNamespace(),
        )
    )

    assert response.token_count == 29
    assert captured["build_kwargs"] == {
        "db": ANY,
        "user_id": user_id,
        "project_id": project_id,
        "object_ids": [object_id],
        "language": "English",
    }
    assert captured["count_kwargs"]["text"] == "Content: selected object body"
    assert captured["count_kwargs"]["allow_custom_base_url"] is False


def test_count_object_content_tokens_empty_selection_returns_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_count_text_tokens(*_args, **kwargs):
        assert kwargs["text"] == ""
        return _token_result(0, provider=str(kwargs["provider"]), model=str(kwargs["model"]))

    monkeypatch.setattr(token_routes, "build_selected_object_token_text", lambda *_args, **_kwargs: "")
    monkeypatch.setattr(token_routes, "count_text_tokens", fake_count_text_tokens)

    response = asyncio.run(
        token_routes.count_object_content_tokens(
            token_routes.CountObjectContentTokensRequest(
                project_id=uuid4(),
                language="English",
                object_ids=[],
                provider="openrouter",
                model="test-model",
            ),
            current_user=SimpleNamespace(id=uuid4()),
            db=SimpleNamespace(),
        )
    )

    assert response.token_count == 0


def test_count_object_content_tokens_propagates_project_404(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_build_text(*_args, **_kwargs):
        raise HTTPException(status_code=404, detail="Project not found")

    monkeypatch.setattr(token_routes, "build_selected_object_token_text", fake_build_text)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            token_routes.count_object_content_tokens(
                token_routes.CountObjectContentTokensRequest(
                    project_id=uuid4(),
                    language="English",
                    object_ids=[uuid4()],
                    provider="openrouter",
                    model="test-model",
                ),
                current_user=SimpleNamespace(id=uuid4()),
                db=SimpleNamespace(),
            )
        )

    assert exc_info.value.status_code == 404

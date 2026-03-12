from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

from App.backend.services import token_count_service


def test_count_openai_message_tokens_adds_tile_estimate_for_images(monkeypatch) -> None:
    monkeypatch.setattr(token_count_service, "_count_tokens_tiktoken", lambda _text, _model: 0)

    message = {
        "role": "user",
        "content_parts": [
            {
                "type": "image",
                "mime_type": "image/png",
                "filename": "sample.png",
                "storage_key": "img-1",
                "width": 1024,
                "height": 1024,
            }
        ],
    }

    count = token_count_service.count_openai_message_tokens("gpt-5.4", message)

    assert count == 70 + 140 * 4


def test_estimate_openai_pdf_tokens_adds_text_and_page_visuals(monkeypatch) -> None:
    class _FakePage:
        def __init__(self, text: str) -> None:
            self._text = text
            self.mediabox = SimpleNamespace(width=612, height=792)

        def extract_text(self) -> str:
            return self._text

    class _FakeReader:
        def __init__(self, _stream) -> None:
            self.pages = [_FakePage("alpha"), _FakePage("")]

    monkeypatch.setattr(token_count_service, "PdfReader", _FakeReader)
    monkeypatch.setattr(token_count_service, "_load_attachment_bytes", lambda _key, _cache=None: b"%PDF-1.7")
    monkeypatch.setattr(
        token_count_service,
        "_count_tokens_tiktoken",
        lambda text, _model: 9 if text == "alpha" else 0,
    )

    part = {
        "type": "file",
        "mime_type": "application/pdf",
        "filename": "doc.pdf",
        "storage_key": "pdf-1",
    }

    count = token_count_service._estimate_openai_pdf_tokens(part, "gpt-5.4", {})

    assert count == (70 + 140 * 4) * 2 + 9


def test_count_claude_message_tokens_uses_multimodal_blocks(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def _fake_count_tokens(messages, model, api_key, base_url=None, system=None):
        captured["messages"] = messages
        captured["model"] = model
        captured["api_key"] = api_key
        captured["base_url"] = base_url
        captured["system"] = system
        return 123

    monkeypatch.setattr(
        token_count_service.credential_service,
        "get_provider_config",
        lambda *_args, **_kwargs: {"api_key": "secret"},
    )
    monkeypatch.setattr(token_count_service, "count_tokens_claude_messages", _fake_count_tokens)
    monkeypatch.setattr(
        token_count_service,
        "build_claude_content",
        lambda _parts: [{"type": "text", "text": "hello"}, {"type": "document", "source": {"type": "base64"}}],
    )

    message = {
        "role": "assistant",
        "content_parts": [{"type": "content", "text": "hello"}, {"type": "file", "storage_key": "pdf-1"}],
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {"name": "search_story", "arguments": '{"query":"hero"}'},
            }
        ],
    }

    result = asyncio.run(
        token_count_service.count_claude_message_tokens(
            object(),
            user_id=uuid4(),
            model="claude-sonnet",
            message=message,
        )
    )

    assert result == 123
    assert captured["api_key"] == "secret"
    messages = captured["messages"]
    assert isinstance(messages, list) and messages
    content = messages[0]["content"]
    assert any(block.get("type") == "document" for block in content)
    assert any(block.get("type") == "tool_use" for block in content)


def test_count_gemini_conversation_tokens_passes_system_instruction(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def _fake_count_tokens(contents, model, api_key, base_url=None, config=None):
        captured["contents"] = contents
        captured["model"] = model
        captured["api_key"] = api_key
        captured["config"] = config
        return 55

    monkeypatch.setattr(
        token_count_service.credential_service,
        "get_provider_config",
        lambda *_args, **_kwargs: {"api_key": "secret"},
    )
    monkeypatch.setattr(token_count_service, "count_tokens_gemini_contents", _fake_count_tokens)

    result = asyncio.run(
        token_count_service.count_gemini_conversation_tokens(
            object(),
            user_id=uuid4(),
            model="gemini-2.5-flash",
            system_prompt="system prompt",
            conversation=[{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}],
        )
    )

    assert result == 55
    assert captured["api_key"] == "secret"
    config = captured["config"]
    assert getattr(config, "system_instruction", None) == "system prompt"

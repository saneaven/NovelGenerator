from __future__ import annotations

import asyncio
import sys
import types
from types import SimpleNamespace
from uuid import uuid4

import pytest

try:
    import sqlalchemy.orm as _sqlalchemy_orm  # noqa: F401
except Exception:
    fake_sqlalchemy = types.ModuleType("sqlalchemy")
    fake_sqlalchemy_orm = types.ModuleType("sqlalchemy.orm")

    class _StubSession:
        pass

    def _stub_declarative_base():
        return object()

    fake_sqlalchemy.orm = fake_sqlalchemy_orm
    fake_sqlalchemy_orm.Session = _StubSession
    fake_sqlalchemy_orm.declarative_base = _stub_declarative_base
    sys.modules["sqlalchemy"] = fake_sqlalchemy
    sys.modules["sqlalchemy.orm"] = fake_sqlalchemy_orm

if "App.backend.models.db_models" not in sys.modules:
    fake_db_models = types.ModuleType("App.backend.models.db_models")

    class _StubRunMessageAttachmentModel:
        pass

    fake_db_models.RunMessageAttachmentModel = _StubRunMessageAttachmentModel
    sys.modules["App.backend.models.db_models"] = fake_db_models

if "App.backend.services.storage_service" not in sys.modules:
    fake_storage_service = types.ModuleType("App.backend.services.storage_service")
    fake_storage_service.storage_service = SimpleNamespace(
        save_raw_file=lambda content, filename, project_id, storage_prefix=None, mime_type=None: (
            "storage-key",
            mime_type or "",
            len(content),
        ),
        delete_asset_files=lambda _storage_key: None,
        read_asset_file=lambda _storage_key: b"",
    )
    sys.modules["App.backend.services.storage_service"] = fake_storage_service

if "App.backend.services.credential_service" not in sys.modules:
    fake_credential_service = types.ModuleType("App.backend.services.credential_service")

    class _StubCredentialServiceError(Exception):
        pass

    fake_credential_service.CredentialServiceError = _StubCredentialServiceError
    fake_credential_service.credential_service = SimpleNamespace(get_provider_config=lambda *_args, **_kwargs: {})
    sys.modules["App.backend.services.credential_service"] = fake_credential_service

if "App.backend.services.token_counting_service" not in sys.modules:
    fake_token_counting_service = types.ModuleType("App.backend.services.token_counting_service")

    async def _count_zero(*_args, **_kwargs) -> int:
        return 0

    fake_token_counting_service.count_tokens_claude = _count_zero
    fake_token_counting_service.count_tokens_claude_messages = _count_zero
    fake_token_counting_service.count_tokens_gemini = _count_zero
    fake_token_counting_service.count_tokens_gemini_contents = _count_zero
    sys.modules["App.backend.services.token_counting_service"] = fake_token_counting_service

if "App.backend.providers.tool_call_arguments" not in sys.modules:
    fake_tool_call_arguments = types.ModuleType("App.backend.providers.tool_call_arguments")
    fake_tool_call_arguments.parse_tool_call_arguments = lambda raw: (raw, raw if isinstance(raw, dict) else {})
    sys.modules["App.backend.providers.tool_call_arguments"] = fake_tool_call_arguments

if "pypdf" not in sys.modules:
    fake_pypdf = types.ModuleType("pypdf")

    class _StubPdfReader:
        def __init__(self, _stream) -> None:
            self.pages = []

    fake_pypdf.PdfReader = _StubPdfReader
    sys.modules["pypdf"] = fake_pypdf

if "PIL" not in sys.modules:
    fake_pil = types.ModuleType("PIL")

    class _StubImageModule:
        @staticmethod
        def open(_stream):
            raise RuntimeError("Image loading is not available in tests")

    fake_pil.Image = _StubImageModule
    sys.modules["PIL"] = fake_pil

if "google.genai" not in sys.modules:
    fake_google = sys.modules.get("google") or types.ModuleType("google")
    fake_genai = types.ModuleType("google.genai")

    class _FakePart:
        def __init__(self, **kwargs) -> None:
            for key, value in kwargs.items():
                setattr(self, key, value)

        @classmethod
        def from_text(cls, *, text: str):
            return cls(text=text)

        @classmethod
        def from_bytes(cls, *, data: bytes, mime_type: str):
            return cls(data=data, mime_type=mime_type)

        @classmethod
        def from_function_response(cls, *, name: str, response: dict[str, object]):
            return cls(name=name, response=response)

        @classmethod
        def from_function_call(cls, *, name: str, args: dict[str, object]):
            return cls(name=name, args=args)

        @classmethod
        def model_validate(cls, data: dict[str, object]):
            return cls(**data)

    class _FakeContent:
        def __init__(self, *, role: str, parts: list[object]) -> None:
            self.role = role
            self.parts = parts

    class _FakeCountTokensConfig:
        def __init__(self, *, system_instruction: str | None = None) -> None:
            self.system_instruction = system_instruction

    fake_genai.types = SimpleNamespace(
        Part=_FakePart,
        Content=_FakeContent,
        CountTokensConfig=_FakeCountTokensConfig,
    )
    fake_google.genai = fake_genai
    sys.modules["google"] = fake_google
    sys.modules["google.genai"] = fake_genai

from App.backend.providers.shared.parsing import multimodal
from App.backend.services.chat_attachment_service import (
    ChatAttachmentValidationError,
    IncomingMessageAttachment,
    chat_attachment_service,
)
from App.backend.services import token_count_service


def test_resolve_tokenizer_uses_provider_specs() -> None:
    assert token_count_service.resolve_tokenizer("ollama_cloud") == "openai"
    assert token_count_service.resolve_tokenizer("claude") == "claude"
    assert token_count_service.resolve_tokenizer("gemini") == "gemini"
    assert token_count_service.resolve_tokenizer("custom", variant_hint="claude") == "claude"


def test_resolve_tokenizer_override_wins_over_provider_spec() -> None:
    assert token_count_service.resolve_tokenizer("gemini", tokenizer_override="openai") == "openai"


def test_resolve_tokenizer_rejects_unknown_and_non_llm_providers() -> None:
    with pytest.raises(ValueError, match="Unknown provider"):
        token_count_service.resolve_tokenizer("not_real")

    with pytest.raises(ValueError, match="does not support llm"):
        token_count_service.resolve_tokenizer("novelai")

    with pytest.raises(ValueError, match="does not support llm variant"):
        token_count_service.resolve_tokenizer("custom", variant_hint="bogus")


def test_inspect_attachment_accepts_utf8_text_files() -> None:
    inspected = chat_attachment_service.inspect_attachment(
        IncomingMessageAttachment(
            filename="data.json",
            mime_type="application/json",
            content=b'{"chapter": 1}',
        )
    )

    assert inspected.kind == "text_file"
    assert inspected.mime_type == "application/json"
    assert inspected.filename == "data.json"
    assert inspected.file_size == len(b'{"chapter": 1}')


def test_inspect_attachment_rejects_non_utf8_text_files() -> None:
    with pytest.raises(ChatAttachmentValidationError, match="File is not valid UTF-8 text"):
        chat_attachment_service.inspect_attachment(
            IncomingMessageAttachment(
                filename="broken.txt",
                mime_type="text/plain",
                content=b"\xc3\x28",
            )
        )


def test_inspect_attachment_rejects_binary_text_files_with_null_bytes() -> None:
    with pytest.raises(ChatAttachmentValidationError, match="binary"):
        chat_attachment_service.inspect_attachment(
            IncomingMessageAttachment(
                filename="renamed.txt",
                mime_type="text/plain",
                content=b"abc\x00def",
            )
        )


def test_inspect_attachment_remaps_octet_stream_text_extension() -> None:
    inspected = chat_attachment_service.inspect_attachment(
        IncomingMessageAttachment(
            filename="story.json",
            mime_type="application/octet-stream",
            content=b'{"title":"Test"}',
        )
    )

    assert inspected.kind == "text_file"
    assert inspected.mime_type == "application/json"


def test_attachment_to_content_part_maps_text_file_kind() -> None:
    attachment = SimpleNamespace(
        kind="text_file",
        mime_type="application/json",
        original_filename="data.json",
        storage_key="text-1",
    )

    assert multimodal.attachment_to_content_part(attachment) == {
        "type": "text_file",
        "mime_type": "application/json",
        "filename": "data.json",
        "storage_key": "text-1",
    }


def test_text_file_builders_emit_standard_text_parts(monkeypatch) -> None:
    monkeypatch.setattr(
        multimodal.chat_attachment_service,
        "load_attachment_bytes",
        lambda _storage_key: b'{"hero":"Aster"}',
    )

    part = {
        "type": "text_file",
        "mime_type": "application/json",
        "filename": "data.json",
        "storage_key": "text-1",
    }
    expected = '<attached_file name="data.json" type="application/json">\n{"hero":"Aster"}\n</attached_file>'

    assert multimodal.build_openai_chat_content([part]) == [{"type": "text", "text": expected}]
    assert multimodal.build_openai_responses_content([part], role="user") == [{"type": "input_text", "text": expected}]
    assert multimodal.build_openai_responses_content([part], role="assistant") == [{"type": "output_text", "text": expected}]
    assert multimodal.build_claude_content([part]) == [{"type": "text", "text": expected}]
    assert multimodal.build_gemini_binary_parts([part]) == [{"type": "text", "text": expected}]


def test_count_openai_message_tokens_includes_text_file_content(monkeypatch) -> None:
    monkeypatch.setattr(
        multimodal.chat_attachment_service,
        "load_attachment_bytes",
        lambda _storage_key: b'{"hero":"Aster"}',
    )
    monkeypatch.setattr(token_count_service, "_openai_message_payload_text", lambda _message: "")
    monkeypatch.setattr(token_count_service, "_count_tokens_tiktoken", lambda text, _model: len(text))

    message = {
        "role": "user",
        "content_parts": [
            {
                "type": "text_file",
                "mime_type": "application/json",
                "filename": "data.json",
                "storage_key": "text-1",
            }
        ],
    }

    expected = '<attached_file name="data.json" type="application/json">\n{"hero":"Aster"}\n</attached_file>'
    count = token_count_service.count_openai_message_tokens("gpt-5.4", message)

    assert count == len(expected)


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

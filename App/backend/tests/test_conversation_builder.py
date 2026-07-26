from __future__ import annotations

from pathlib import Path
import sys
import types
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    fake_chat_attachment_service = types.ModuleType("App.backend.services.chat_attachment_service")
    fake_chat_attachment_service.chat_attachment_service = SimpleNamespace(
        load_attachment_bytes=lambda _storage_key: b"",
        to_data_url=lambda mime_type, _data: f"data:{mime_type};base64,",
    )
    sys.modules["App.backend.services.chat_attachment_service"] = fake_chat_attachment_service


_install_import_stubs()

from App.backend.models.db_models import Asset, RunMessageAttachmentModel, RunMessageModel, RunToolCallModel
from App.backend.services.prompt_runtime.conversation_builder import build_from_runs


class _FakeQuery:
    def __init__(self, rows: list[object]) -> None:
        self._rows = list(rows)

    def filter(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        return self

    def order_by(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        return self

    def all(self) -> list[object]:
        return list(self._rows)

    def first(self) -> object | None:
        return self._rows[0] if self._rows else None


class _FakeDb:
    def __init__(self, rows_by_model: dict[object, list[object]]) -> None:
        self._rows_by_model = rows_by_model

    def query(self, model: object) -> _FakeQuery:
        return _FakeQuery(self._rows_by_model.get(model, []))


def test_build_from_runs_keeps_tool_call_only_assistant_and_attached_tool_results() -> None:
    thread_id = uuid4()
    run_id = uuid4()
    assistant_id = uuid4()
    tool_id = uuid4()

    reasoning_detail = {
        "type": "openai",
        "meta": {"provider": "openai"},
        "data": {
            "output_items": [
                {
                    "id": "rs_1",
                    "type": "reasoning",
                    "summary": [],
                    "encrypted_content": "enc",
                    "status": "completed",
                },
                {
                    "id": "fc_1",
                    "type": "function_call",
                    "call_id": "call_1",
                    "name": "read_story_entity",
                    "arguments": '{ "id" : "abc" }',
                    "status": "completed",
                },
            ],
        },
        "token_count": 0,
    }

    assistant_row = SimpleNamespace(
        id=assistant_id,
        thread_id=thread_id,
        run_id=run_id,
        role="assistant",
        seq_in_thread=4,
        created_at=None,
        data={"English": {"contentParts": [], "reasoningDetail": reasoning_detail}},
    )
    tool_row = SimpleNamespace(
        id=tool_id,
        assistant_message_id=assistant_id,
        call_seq=0,
        status="applied",
        llm_call_id="call_1",
        tool_name="read_story_entity",
        arguments={"id": "abc"},
        extra_content=None,
        result={"success": True, "message": "done"},
        reason=None,
    )

    db = _FakeDb(
        {
            RunMessageModel: [assistant_row],
            RunMessageAttachmentModel: [],
            RunToolCallModel: [tool_row],
        }
    )

    conversation = build_from_runs(db, thread_id=thread_id, language="English")

    assert [msg["role"] for msg in conversation] == ["assistant", "tool_results"]
    assert conversation[0]["content_parts"] == []
    assert conversation[0]["reasoning_detail"] == reasoning_detail
    assert conversation[0]["tool_calls"] == [
        {
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "read_story_entity",
                "arguments": '{"id": "abc"}',
            },
        }
    ]
    assert conversation[1]["tool_results"][0]["tool_call_id"] == "call_1"


def test_build_from_runs_preserves_project_tree_payload_in_tool_result_content() -> None:
    thread_id = uuid4()
    run_id = uuid4()
    assistant_id = uuid4()
    tool_id = uuid4()

    assistant_row = SimpleNamespace(
        id=assistant_id,
        thread_id=thread_id,
        run_id=run_id,
        role="assistant",
        seq_in_thread=2,
        created_at=None,
        data={"English": {"contentParts": []}},
    )
    tool_row = SimpleNamespace(
        id=tool_id,
        assistant_message_id=assistant_id,
        call_seq=0,
        status="applied",
        llm_call_id="call_1",
        tool_name="get_project_tree",
        arguments={},
        extra_content=None,
        result={
            "success": True,
            "message": "Project tree retrieved",
            "data": {
                "tree": {
                    "title": "The Last Kingdom",
                    "storyEntities": [
                        {
                            "nodeType": "folder",
                            "id": "folder-1",
                            "name": "Cast",
                            "children": [
                                {
                                    "nodeType": "entity",
                                    "id": "entity-1",
                                    "name": "Ari",
                                    "kind": "character",
                                }
                            ],
                        }
                    ],
                    "outline": [
                        {
                            "id": "outline-root",
                            "kind": "outline",
                            "name": "Book",
                            "children": [
                                {
                                    "id": "chapter-1",
                                    "kind": "chapter",
                                    "name": "Opening",
                                    "actNumber": 1,
                                    "chapterNumber": 1,
                                    "manuscriptId": "manuscript-1",
                                }
                            ],
                        }
                    ],
                    "timeline": {
                        "tracks": [
                            {
                                "id": "track-1",
                                "name": "Main",
                                "eventCount": 2,
                                "position": 0,
                                "children": [],
                            }
                        ]
                    },
                }
            },
        },
        reason=None,
    )

    db = _FakeDb(
        {
            RunMessageModel: [assistant_row],
            RunMessageAttachmentModel: [],
            RunToolCallModel: [tool_row],
        }
    )

    conversation = build_from_runs(db, thread_id=thread_id, language="English")

    content = conversation[1]["tool_results"][0]["content"]
    assert "<project_tree>" in content
    assert "<title>The Last Kingdom</title>" in content
    assert '<folder id="folder-1" name="Cast">' in content
    assert '<entity id="entity-1" name="Ari" kind="character" />' in content
    assert 'id="chapter-1"' in content
    assert 'manuscriptId="manuscript-1"' in content
    assert '<track id="track-1" name="Main" eventCount="2" position="0" />' in content
    assert "Project tree retrieved" not in content


def test_build_from_runs_preserves_structured_fallback_payloads() -> None:
    thread_id = uuid4()
    run_id = uuid4()
    assistant_id = uuid4()
    tool_id = uuid4()

    assistant_row = SimpleNamespace(
        id=assistant_id,
        thread_id=thread_id,
        run_id=run_id,
        role="assistant",
        seq_in_thread=2,
        created_at=None,
        data={"English": {"contentParts": []}},
    )
    tool_row = SimpleNamespace(
        id=tool_id,
        assistant_message_id=assistant_id,
        call_seq=0,
        status="applied",
        llm_call_id="call_1",
        tool_name="mcp_example",
        arguments={},
        extra_content=None,
        result={
            "success": True,
            "message": "MCP text",
            "data": {"structured": {"foo": "bar", "count": 2}},
        },
        reason=None,
    )

    db = _FakeDb(
        {
            RunMessageModel: [assistant_row],
            RunMessageAttachmentModel: [],
            RunToolCallModel: [tool_row],
        }
    )

    conversation = build_from_runs(db, thread_id=thread_id, language="English")

    content = conversation[1]["tool_results"][0]["content"]
    assert "<message>MCP text</message>" in content
    assert '<payload key="structured">{"foo":"bar","count":2}</payload>' in content


def test_build_from_runs_attaches_read_image_asset_parts() -> None:
    thread_id = uuid4()
    run_id = uuid4()
    assistant_id = uuid4()
    tool_id = uuid4()
    asset_id = uuid4()

    assistant_row = SimpleNamespace(
        id=assistant_id,
        thread_id=thread_id,
        run_id=run_id,
        role="assistant",
        seq_in_thread=2,
        created_at=None,
        data={"English": {"contentParts": []}},
    )
    tool_row = SimpleNamespace(
        id=tool_id,
        assistant_message_id=assistant_id,
        call_seq=0,
        status="applied",
        llm_call_id="call_1",
        tool_name="read_image",
        arguments={"image_id": str(asset_id)},
        extra_content=None,
        result={"success": True, "message": "image meta", "data": {"image_asset_ids": [str(asset_id)]}},
        reason=None,
    )
    asset_row = SimpleNamespace(
        id=asset_id,
        project_id=uuid4(),
        mime_type="image/png",
        file_path="assets/pic.png",
        name="pic",
    )

    db = _FakeDb(
        {
            RunMessageModel: [assistant_row],
            RunMessageAttachmentModel: [],
            RunToolCallModel: [tool_row],
            Asset: [asset_row],
        }
    )

    conversation = build_from_runs(db, thread_id=thread_id, language="English")

    tool_results = conversation[1]["tool_results"][0]
    assert tool_results["image_parts"] == [
        {
            "type": "image",
            "source": "asset",
            "mime_type": "image/png",
            "storage_key": "assets/pic.png",
            "filename": "pic",
            "asset_id": str(asset_id),
        }
    ]

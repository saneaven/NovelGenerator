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

from App.backend.models.db_models import RunMessageAttachmentModel, RunMessageModel, RunToolCallModel
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
            "items": [{"id": "rs_1", "type": "reasoning", "encrypted_content": "enc"}],
            "output_msg_id": "msg_1",
            "function_call_item_ids": {"call_1": "fc_1"},
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
        tool_name="read_story_object",
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
                "name": "read_story_object",
                "arguments": '{"id": "abc"}',
            },
        }
    ]
    assert conversation[1]["tool_results"][0]["tool_call_id"] == "call_1"


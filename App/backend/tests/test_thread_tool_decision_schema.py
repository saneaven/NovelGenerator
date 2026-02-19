from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

from App.backend.schemas.thread_api import ToolCallDecisionResponse


def test_tool_call_decision_response_has_no_new_objects_field() -> None:
    now = datetime.utcnow()
    payload = {
        "tool_call": {
            "id": uuid4(),
            "thread_id": uuid4(),
            "run_id": uuid4(),
            "message_id": uuid4(),
            "assistant_message_id": None,
            "call_seq": 0,
            "llm_call_id": "call_1",
            "tool_name": "read_story_object",
            "arguments": {},
            "status": "applied",
            "reason": None,
            "result": {"success": True},
            "child_thread_id": None,
            "accepted_at": None,
            "created_at": now,
            "updated_at": now,
        }
    }

    response = ToolCallDecisionResponse(**payload)

    assert "new_objects" not in response.model_dump()


def test_tool_decision_backend_contract_has_no_new_objects_literal() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    routes_text = (backend_root / "routes" / "thread_routes.py").read_text(encoding="utf-8")
    executor_text = (backend_root / "services" / "tool_call_executor.py").read_text(encoding="utf-8")

    assert "new_objects" not in routes_text
    assert "new_objects" not in executor_text

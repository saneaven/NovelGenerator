from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from App.backend.schemas.thread_api import ToolCallDecisionResponse, ToolCallImageActionRequest


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
    engine_text = (backend_root / "services" / "tool_engine" / "service.py").read_text(encoding="utf-8")

    assert "new_objects" not in routes_text
    assert "new_objects" not in engine_text


def test_image_action_route_exists() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    routes_text = (backend_root / "routes" / "thread_routes.py").read_text(encoding="utf-8")

    assert '"/threads/{thread_id}/tool-calls/{tool_call_id}/image-actions"' in routes_text


def test_image_action_schema_only_allows_accept_and_reject() -> None:
    assert ToolCallImageActionRequest(action="accept").action == "accept"
    assert ToolCallImageActionRequest(action="reject").action == "reject"
    with pytest.raises(ValidationError):
        ToolCallImageActionRequest(action="generate")

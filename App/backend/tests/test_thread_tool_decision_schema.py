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
            "tool_name": "read_story_entity",
            "arguments": {},
            "status": "applied",
            "reason": None,
            "result": {"success": True},
            "child_thread_id": None,
            "image_run_id": uuid4(),
            "accepted_at": None,
            "created_at": now,
            "updated_at": now,
        }
    }

    response = ToolCallDecisionResponse(**payload)

    assert "new_objects" not in response.model_dump()
    assert response.tool_call.image_run_id is not None


def test_tool_decision_backend_contract_has_no_new_objects_literal() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    routes_text = (backend_root / "routes" / "thread_routes.py").read_text(encoding="utf-8")
    engine_text = (backend_root / "services" / "tool_engine" / "service.py").read_text(encoding="utf-8")

    assert "new_objects" not in routes_text
    assert "new_objects" not in engine_text


def test_image_action_route_is_removed() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    routes_text = (backend_root / "routes" / "thread_routes.py").read_text(encoding="utf-8")

    assert '"/threads/{thread_id}/tool-calls/{tool_call_id}/image-actions"' not in routes_text


def test_image_run_routes_exist() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    routes_text = (backend_root / "routes" / "image_run_routes.py").read_text(encoding="utf-8")

    assert '"/{project_id}/image-runs"' in routes_text
    assert '"/{project_id}/image-runs/{image_run_id}/decision"' in routes_text
    assert '"/{project_id}/image-runs/{image_run_id}/cancel"' in routes_text

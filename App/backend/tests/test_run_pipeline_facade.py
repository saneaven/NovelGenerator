from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from App.backend.tests.run_pipeline_test_support import FakeEventDispatcher, run_service


def test_start_run_rejects_empty_request_before_db() -> None:
    pipeline = run_service.RunPipeline(
        db_factory=lambda: (_ for _ in ()).throw(AssertionError("db should not be touched")),
        event_dispatcher=FakeEventDispatcher(),  # type: ignore[arg-type]
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            pipeline.start_run(
                thread_id=uuid4(),
                user_id=uuid4(),
                input_text="",
                input_payload=None,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
                language=None,
                attachments=[],
                mcp_selections=[],
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "input_text, attachments, or mcp_selections are required for create run"

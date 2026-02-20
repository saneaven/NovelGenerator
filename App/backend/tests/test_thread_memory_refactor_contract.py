from __future__ import annotations

from pathlib import Path

from App.backend.schemas.thread_api import ThreadInfoResponse
from App.backend.services.memory_service import _build_memory_chunks


def test_agent_memory_fragment_has_no_rag_texts_section() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    fragment = (backend_root / "prompts" / "default_fragments" / "common" / "agentMemory" / "section.md").read_text(
        encoding="utf-8"
    )

    assert "ragTexts" not in fragment
    assert "<rag_text>" not in fragment
    assert "historyChats" in fragment
    assert "summaries" in fragment


def test_build_memory_chunks_tool_call_field_paths_are_thread_memory_shape() -> None:
    chunks = _build_memory_chunks(
        message_req={
            "content": "A" * 280,
            "tool_calls": [
                {
                    "id": "call-1",
                    "name": "search_story",
                    "arguments": {"query": "protagonist wound"},
                    "result": {"message": "Found prior mention in chapter 3"},
                    "reason": "reconcile continuity",
                    "status": "applied",
                }
            ],
        }
    )

    assert chunks
    field_paths = {str(chunk.get("field_path") or "") for chunk in chunks}
    assert "content" in field_paths
    assert "tool_calls/call-1/arguments" in field_paths
    assert "tool_calls/call-1/result" in field_paths
    assert "tool_calls/call-1/reason" in field_paths
    assert all(not path.endswith("/status") for path in field_paths)

    argument_chunks = [c for c in chunks if c.get("field_path") == "tool_calls/call-1/arguments"]
    assert argument_chunks
    assert any("tool_name: search_story" in str(c.get("text") or "") for c in argument_chunks)


def test_thread_info_response_exposes_memory_boundary_message_id() -> None:
    fields = ThreadInfoResponse.model_fields
    assert "memory_boundary_message_id" in fields


def test_run_pipeline_executes_preflight_before_memory_prompt_build() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (backend_root / "services" / "run_pipeline" / "llm_executor.py").read_text(encoding="utf-8")

    preflight_idx = source.find("await _mem.prepare_thread_memory_preflight(")
    memory_prompt_idx = source.find("memory_prompt = await build_memory_prompt(")

    assert preflight_idx != -1
    assert memory_prompt_idx != -1
    assert preflight_idx < memory_prompt_idx


def test_thread_memory_search_query_is_thread_scoped() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (backend_root / "services" / "memory_service.py").read_text(encoding="utf-8")

    assert "AND s.thread_id = :thread_id" in source

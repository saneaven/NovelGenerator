from __future__ import annotations

from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_llm_execution_uses_provider_hooks_directly() -> None:
    prepare_source = (
        BACKEND_ROOT / "services" / "run_pipeline" / "llm_execution" / "prepare.py"
    ).read_text(encoding="utf-8")
    persist_source = (
        BACKEND_ROOT / "services" / "run_pipeline" / "llm_execution" / "persist.py"
    ).read_text(encoding="utf-8")

    assert "get_provider_io" not in prepare_source
    assert "get_provider_io" not in persist_source
    assert "provider.get_stream_thinking_display_path(advanced)" in prepare_source
    assert "prepared.provider.read_reasoning_detail(final_snapshot, prepared.advanced)" in persist_source
    assert "provider.read_reasoning_tokens(final_snapshot)" in persist_source

from __future__ import annotations

from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_llm_executor_uses_provider_hooks_directly() -> None:
    source = (BACKEND_ROOT / "services" / "run_pipeline" / "llm_executor.py").read_text(encoding="utf-8")

    assert "get_provider_io" not in source
    assert "provider.get_stream_thinking_display_path(advanced)" in source
    assert "provider.read_reasoning_detail(final_snapshot, advanced)" in source
    assert "provider.read_reasoning_tokens(final_snapshot)" in source


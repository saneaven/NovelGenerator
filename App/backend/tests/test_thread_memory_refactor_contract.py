from __future__ import annotations

from pathlib import Path
import sys
import types

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

    credential_service = types.ModuleType("App.backend.services.credential_service")
    credential_service.credential_service = object()
    sys.modules["App.backend.services.credential_service"] = credential_service

    embedding_config_service = types.ModuleType("App.backend.services.embedding_config_service")
    embedding_config_service.get_embedding_profile = lambda *_args, **_kwargs: None
    embedding_config_service.set_embedding_dimensions = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.embedding_config_service"] = embedding_config_service

    semantic_embedding_service = types.ModuleType("App.backend.services.semantic_embedding_service")
    semantic_embedding_service.embed_many = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.semantic_embedding_service"] = semantic_embedding_service

    memory_pkg = types.ModuleType("App.backend.services.memory")
    memory_pkg.__path__ = [str(ROOT / "App" / "backend" / "services" / "memory")]
    sys.modules["App.backend.services.memory"] = memory_pkg

    tool_engine_pkg = types.ModuleType("App.backend.services.tool_engine")
    tool_engine_pkg.__path__ = [str(ROOT / "App" / "backend" / "services" / "tool_engine")]
    sys.modules["App.backend.services.tool_engine"] = tool_engine_pkg

    grant_catalog = types.ModuleType("App.backend.services.tool_engine.grant_catalog")
    grant_catalog.FeatureKey = str
    grant_catalog.ToolCategory = str
    sys.modules["App.backend.services.tool_engine.grant_catalog"] = grant_catalog

    mistune = types.ModuleType("mistune")
    mistune.create_markdown = lambda **_kwargs: (lambda _text: [])
    sys.modules["mistune"] = mistune

    markdown_it_pyrs = types.ModuleType("markdown_it_pyrs")

    class _MarkdownIt:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def enable_many(self, *_args, **_kwargs):
            return self

        def parse(self, *_args, **_kwargs):
            return []

    markdown_it_pyrs.MarkdownIt = _MarkdownIt
    sys.modules["markdown_it_pyrs"] = markdown_it_pyrs


_install_import_stubs()

from App.backend.schemas.thread_api import ThreadInfoResponse
from App.backend.services.default_preset_seed import load_default_preset_seed
from App.backend.services.memory.vector_pipeline import _build_memory_chunks


def test_memory_fragment_uses_current_memory_sections() -> None:
    seed = load_default_preset_seed()
    fragment = next(
        item.content
        for item in seed.fragments
        if item.folder_key == "common/memory" and item.fragment_name == "section"
    )

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


def test_prepare_execution_uses_archive_loop_reassembly_without_memory_injection() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (
        backend_root / "services" / "run_pipeline" / "llm_execution" / "prepare.py"
    ).read_text(encoding="utf-8")

    assert "archive_orchestrator.pick_boundary(" in source
    assert "prompt_assembly.reassemble_create(" in source
    assert "current_bundle is None" not in source
    assert "is_memory_prompt" not in source


def test_prompt_assembly_resume_keeps_bundle_contract() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (
        backend_root / "services" / "run_pipeline" / "prompt_assembly.py"
    ).read_text(encoding="utf-8")

    assert "ScenarioBundle | None" not in source
    assert "return system_prompt, conversation, bundle" in source


def test_search_tools_are_offer_gated_by_vector_storage() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (
        backend_root / "services" / "tool_engine" / "modules" / "search_feature_module.py"
    ).read_text(encoding="utf-8")
    legacy_gate = "enabled_when" + "=_vector_storage_enabled"

    assert "ctx.vector_storage_enabled" in source
    assert '"search_regex"' in source
    assert '"search_semantic"' in source
    assert legacy_gate not in source


def test_archive_orchestrator_invalidates_resume_cache() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (backend_root / "services" / "memory" / "archive_orchestrator.py").read_text(encoding="utf-8")

    assert "thread.captured_prompt_snapshot = None" in source


def test_settings_contract_uses_search_memory_settings_field() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    schema_source = (backend_root / "schemas" / "settings.py").read_text(encoding="utf-8")
    route_source = (backend_root / "routes" / "settings_routes.py").read_text(encoding="utf-8")

    assert "searchMemorySettings" in schema_source
    assert "vectorStorageEnabled" not in schema_source
    assert "searchMemorySettings" in route_source
    assert "vectorStorageEnabled" not in route_source


def test_thread_memory_search_query_is_thread_scoped() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (backend_root / "services" / "memory_service.py").read_text(encoding="utf-8")

    assert "AND s.thread_id = :thread_id" in source


def test_thread_message_builder_filters_archived_sequences() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (backend_root / "services" / "prompt_runtime" / "conversation_builder.py").read_text(encoding="utf-8")

    assert "archived_until_seq_in_thread" in source
    assert "RunMessageModel.seq_in_thread > int(archived_until_seq_in_thread)" in source

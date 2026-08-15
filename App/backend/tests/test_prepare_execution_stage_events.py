from __future__ import annotations

import asyncio
import importlib
import sys
import types
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


fake_db_models = types.ModuleType("App.backend.models.db_models")


@dataclass(frozen=True)
class _RunModel:
    id: object
    thread_id: object
    user_id: object
    project_id: object
    status: str
    language: str


@dataclass(frozen=True)
class _Thread:
    id: object
    project_id: object
    user_id: object
    thread_type: str
    status: str


class _RunMessageModel:
    id = object()
    role = object()


class _ThreadPromptCache:
    pass


fake_db_models.RunModel = _RunModel
fake_db_models.Thread = _Thread
fake_db_models.RunMessageModel = _RunMessageModel
fake_db_models.ThreadPromptCache = _ThreadPromptCache
sys.modules["App.backend.models.db_models"] = fake_db_models

fake_registry = types.ModuleType("App.backend.providers.registry")
fake_registry.create_llm_provider = lambda *_args, **_kwargs: None
sys.modules["App.backend.providers.registry"] = fake_registry

fake_stream_retry = types.ModuleType("App.backend.providers.shared.transport.stream_retry")
fake_stream_retry.normalize_retry_config = lambda value: value
sys.modules["App.backend.providers.shared.transport.stream_retry"] = fake_stream_retry

fake_runtime = types.ModuleType("App.backend.services.llm_runtime_service")
fake_runtime.get_llm_runtime = lambda *_args, **_kwargs: None
sys.modules["App.backend.services.llm_runtime_service"] = fake_runtime

fake_mcp = types.ModuleType("App.backend.services.mcp")
fake_mcp.mcp_sync_service = SimpleNamespace(sync_stale_tool_servers=None)
sys.modules["App.backend.services.mcp"] = fake_mcp

fake_memory = types.ModuleType("App.backend.services.memory")
fake_memory.archive_orchestrator = SimpleNamespace(pick_boundary=None, run=None)
sys.modules["App.backend.services.memory"] = fake_memory

fake_output_mode = types.ModuleType("App.backend.services.prompt_runtime.output_mode")
fake_output_mode.resolve_output_mode = lambda *_args, **_kwargs: "text"
sys.modules["App.backend.services.prompt_runtime.output_mode"] = fake_output_mode

fake_history_filter = types.ModuleType("App.backend.services.reasoning.history_filter")
fake_history_filter.filter_history_by_run = lambda messages, **_kwargs: messages
sys.modules["App.backend.services.reasoning.history_filter"] = fake_history_filter

fake_mode_policy = types.ModuleType("App.backend.services.reasoning.mode_policy")
fake_mode_policy.apply_thinking_mode = lambda messages, *_args, **_kwargs: messages
sys.modules["App.backend.services.reasoning.mode_policy"] = fake_mode_policy

fake_settings = types.ModuleType("App.backend.services.settings_service")
fake_settings.settings_service = SimpleNamespace(
    get_active_preset_id=lambda *_args, **_kwargs: None,
    is_vector_storage_enabled=lambda *_args, **_kwargs: False,
    get_retry_config=lambda *_args, **_kwargs: None,
)
sys.modules["App.backend.services.settings_service"] = fake_settings

fake_parent_runtime = types.ModuleType("App.backend.services.thread_parent_runtime_service")
fake_parent_runtime.resolve_parent = lambda *_args, **_kwargs: SimpleNamespace(
    journey_kind=None, sub_agent_definition=None
)
sys.modules["App.backend.services.thread_parent_runtime_service"] = fake_parent_runtime

fake_token_count = types.ModuleType("App.backend.services.token_count_service")
fake_token_count.count_conversation_tokens = lambda *_args, **_kwargs: 0
sys.modules["App.backend.services.token_count_service"] = fake_token_count

fake_tool_engine = types.ModuleType("App.backend.services.tool_engine")
fake_tool_engine.tool_engine = SimpleNamespace(build_offer_for_run=lambda *_args, **_kwargs: None)
sys.modules["App.backend.services.tool_engine"] = fake_tool_engine

fake_prompt_cache_service = types.ModuleType("App.backend.services.prompt_cache_service")
fake_prompt_cache_service.annotate_conversation_render_indices = lambda conversation: list(conversation)
fake_prompt_cache_service.build_prepared_cache_plan = lambda **_kwargs: SimpleNamespace(as_metrics=lambda: {})
sys.modules["App.backend.services.prompt_cache_service"] = fake_prompt_cache_service

fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
fake_run_pipeline.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline")]
sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

fake_prompt_assembly = types.ModuleType("App.backend.services.run_pipeline.prompt_assembly")
fake_prompt_assembly.reassemble_create = None
sys.modules["App.backend.services.run_pipeline.prompt_assembly"] = fake_prompt_assembly

fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
fake_llm_execution.__path__ = [
    str(ROOT / "App" / "backend" / "services" / "run_pipeline" / "llm_execution")
]
sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution

fake_contracts = types.ModuleType("App.backend.services.run_pipeline.llm_execution.contracts")
fake_contracts.EmitFn = object


@dataclass(frozen=True)
class _LLMExecutionRequest:
    db: object
    run: object
    thread: object
    settings: object
    system_prompt: str
    conversation: list[dict[str, object]]
    cache_boundaries: list[dict[str, object]]
    scenario_bundle: object
    input_payload: dict[str, object]
    checkpoint: object
    emit_fn: object = None


@dataclass
class _PreparedLLMExecution:
    preset_id: object
    runtime: object
    task_config: object
    provider: object
    tool_offer: object
    output_mode: str
    native_tool_call_mode: bool
    advanced: dict[str, object]
    thinking_mode: str
    effective_thinking_config: dict[str, object] | None
    provider_messages: list[dict[str, object]]
    prepared_cache_plan: object
    stream_thinking_display: str | None
    retry_cfg: object | None


fake_contracts.LLMExecutionRequest = _LLMExecutionRequest
fake_contracts.PreparedLLMExecution = _PreparedLLMExecution
sys.modules["App.backend.services.run_pipeline.llm_execution.contracts"] = fake_contracts

prepare_module = importlib.import_module("App.backend.services.run_pipeline.llm_execution.prepare")


class _Provider:
    def validate_config(self) -> bool:
        return True

    def get_stream_thinking_display_path(self, _advanced) -> None:
        return None

    def set_thinking_template(self, _template) -> None:
        return None


def test_context_budget_tokens_uses_full_window_without_safety_margin() -> None:
    task_config = SimpleNamespace(context_window_tokens=256000, max_output_tokens=138744)

    assert prepare_module._context_budget_tokens(task_config) == 117256


def test_context_budget_tokens_uses_default_reserved_completion() -> None:
    task_config = SimpleNamespace(context_window_tokens=32000, max_output_tokens=None)

    assert prepare_module._context_budget_tokens(task_config) == 32000


def test_context_budget_tokens_returns_zero_without_local_window() -> None:
    assert prepare_module._context_budget_tokens(
        SimpleNamespace(context_window_tokens=None, max_output_tokens=1000)
    ) == 0
    assert prepare_module._context_budget_tokens(
        SimpleNamespace(context_window_tokens=0, max_output_tokens=1000)
    ) == 0


def test_prepare_execution_emits_summarizing_stage_per_archive_iteration(monkeypatch) -> None:
    run = _RunModel(
        id=uuid4(),
        thread_id=uuid4(),
        user_id=uuid4(),
        project_id=uuid4(),
        status="running",
        language="English",
    )
    thread = _Thread(
        id=run.thread_id,
        project_id=run.project_id,
        user_id=run.user_id,
        thread_type="agent",
        status="running",
    )
    scenario_bundle = SimpleNamespace(
        task_type="agent",
        task_subtype="agentMode",
        template_data={},
        blocks=[],
        system_template="",
        project_data={},
        template_renderer_factory=None,
    )
    task_config = SimpleNamespace(
        provider="test",
        model="model-a",
        advanced={},
        max_output_tokens=100,
        context_window_tokens=1000,
    )
    provider = _Provider()
    emitted: list[tuple[str, dict[str, object]]] = []
    reassemble_calls: list[dict[str, object]] = []
    archive_calls: list[object] = []
    boundaries = iter(["boundary-1", "boundary-2"])
    token_counts = iter([950, 925, 100])

    async def _emit_fn(*, event_name: str, data: dict[str, object], **_kwargs) -> None:
        emitted.append((event_name, data))

    async def _sync_stale_tool_servers(*_args, **_kwargs) -> None:
        return None

    async def _archive_run(*_args, **kwargs) -> None:
        archive_calls.append(kwargs["boundary"])

    async def _reassemble_create(*_args, **kwargs):
        reassemble_calls.append(kwargs)
        return "system", [], scenario_bundle, []

    async def _count_provider_messages_tokens(**_kwargs) -> int:
        return next(token_counts)

    monkeypatch.setattr(prepare_module.settings_service, "get_active_preset_id", lambda *_args, **_kwargs: "preset-a")
    monkeypatch.setattr(prepare_module.settings_service, "is_vector_storage_enabled", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(prepare_module.settings_service, "get_retry_config", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        prepare_module,
        "get_llm_runtime",
        lambda *_args, **_kwargs: SimpleNamespace(task_config=task_config, provider_config={}),
    )
    monkeypatch.setattr(
        prepare_module,
        "resolve_parent",
        lambda *_args, **_kwargs: SimpleNamespace(journey_kind=None, sub_agent_definition=None),
    )
    monkeypatch.setattr(prepare_module, "resolve_output_mode", lambda *_args, **_kwargs: "text")
    monkeypatch.setattr(prepare_module.mcp_sync_service, "sync_stale_tool_servers", _sync_stale_tool_servers)
    monkeypatch.setattr(prepare_module.tool_engine, "build_offer_for_run", lambda *_args, **_kwargs: "tool-offer")
    monkeypatch.setattr(prepare_module, "create_llm_provider", lambda *_args, **_kwargs: provider)
    monkeypatch.setattr(
        prepare_module,
        "_apply_provider_history_filters",
        lambda **_kwargs: [{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}],
    )
    monkeypatch.setattr(prepare_module, "_count_provider_messages_tokens", _count_provider_messages_tokens)
    monkeypatch.setattr(prepare_module, "_current_run_user_message_id", lambda *_args, **_kwargs: uuid4())
    monkeypatch.setattr(prepare_module.archive_orchestrator, "pick_boundary", lambda *_args, **_kwargs: next(boundaries))
    monkeypatch.setattr(prepare_module.archive_orchestrator, "run", _archive_run)
    monkeypatch.setattr(prepare_module.prompt_assembly, "reassemble_create", _reassemble_create)
    monkeypatch.setattr(prepare_module, "normalize_retry_config", lambda value: value)

    request = _LLMExecutionRequest(
        db=object(),
        run=run,
        thread=thread,
        settings=SimpleNamespace(
            native_output_mode=False,
            tool_call_history_limit=5,
            thinking_history_limit=5,
        ),
        system_prompt="system",
        conversation=[],
        cache_boundaries=[],
        scenario_bundle=scenario_bundle,
        input_payload={},
        checkpoint=SimpleNamespace(),
        emit_fn=_emit_fn,
    )

    prepared = asyncio.run(prepare_module.prepare_execution(request))

    assert [name for name, _data in emitted] == ["run:stage", "run:stage"]
    assert [data["stage"] for _name, data in emitted] == [
        "summarizing_context",
        "summarizing_context",
    ]
    assert all(data["run_id"] == str(run.id) for _name, data in emitted)
    assert archive_calls == ["boundary-1", "boundary-2"]
    assert len(reassemble_calls) == 2
    assert all("emit_fn" not in call for call in reassemble_calls)
    assert prepared.provider is provider
    assert prepared.provider_messages == [{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}]

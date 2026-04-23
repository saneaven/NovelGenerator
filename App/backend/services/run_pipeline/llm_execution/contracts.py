from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy.orm import Session

from ....models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from ....providers.shared.base import BaseProvider
from ....providers.shared.contracts import FinalSnapshot
from ....providers.shared.transport.stream_retry import NormalizedRetryConfig
from ...llm_runtime_service import LLMRuntime
from ...prompt_runtime.contracts import ScenarioBundle
from ...settings_service import TaskConfig
from ...tool_engine.contracts import ToolOffer

EmitFn = Callable[..., Awaitable[None]]
PersistToolCallsFn = Callable[..., Awaitable[list[RunToolCallModel]]]
SyncStatusFn = Callable[..., Awaitable[None]]


@dataclass
class ExecutionCheckpoint:
    message_id: Any | None = None
    request_id: str | None = None
    finalized: bool = False


@dataclass(frozen=True)
class LLMExecutionCallbacks:
    emit_fn: EmitFn
    persist_tool_calls_fn: PersistToolCallsFn
    sync_status_fn: SyncStatusFn


@dataclass(frozen=True)
class LLMExecutionRequest:
    db: Session
    run: RunModel
    thread: Thread
    settings: UserSettings
    system_prompt: str
    conversation: list[dict[str, Any]]
    scenario_bundle: ScenarioBundle
    input_payload: dict[str, Any]
    checkpoint: ExecutionCheckpoint


@dataclass
class PreparedLLMExecution:
    preset_id: Any
    runtime: LLMRuntime
    task_config: TaskConfig
    provider: BaseProvider
    tool_offer: ToolOffer
    output_mode: str
    native_tool_call_mode: bool
    advanced: dict[str, Any]
    thinking_mode: str
    effective_thinking_config: dict[str, Any] | None
    provider_messages: list[dict[str, Any]]
    stream_thinking_display: str | None
    retry_cfg: NormalizedRetryConfig | None


@dataclass(frozen=True)
class StreamExecutionResult:
    final_snapshot: FinalSnapshot
    raw_response: dict[str, Any] | None
    request_id: str | None = None


@dataclass(frozen=True)
class PersistedExecutionResult:
    assistant_message: RunMessageModel
    tool_call_summaries: list[dict[str, Any]]

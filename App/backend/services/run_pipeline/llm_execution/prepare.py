from __future__ import annotations

from typing import Any
from uuid import UUID

from ....models.db_models import RunMessageModel
from ....providers.registry import create_llm_provider
from ....providers.shared.transport.stream_retry import normalize_retry_config
from ...llm_runtime_service import get_llm_runtime
from ...mcp import mcp_sync_service
from ...memory import archive_orchestrator
from ...prompt_runtime.output_mode import resolve_output_mode
from ...prompt_cache_service import (
    annotate_conversation_render_indices,
    build_prepared_cache_plan,
)
from ...reasoning.history_filter import filter_history_by_run
from ...reasoning.mode_policy import apply_thinking_mode
from ...settings_service import settings_service
from ...thread_parent_runtime_service import resolve_parent
from ...token_count_service import count_conversation_tokens
from ...tool_engine import tool_engine
from .. import prompt_assembly
from .contracts import LLMExecutionRequest, PreparedLLMExecution
from .stage_events import emit_stage


MAX_ARCHIVE_LOOPS = 4
ARCHIVE_SAFETY_MARGIN = 256
DEFAULT_RESERVED_COMPLETION = 2048


class ContextOverflowError(RuntimeError):
    pass


def _strip_internal_message_keys(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for message in messages:
        item = dict(message)
        item.pop("run_id", None)
        item.pop("seq_in_thread", None)
        item.pop("_render_index", None)
        out.append(item)
    return out


def _apply_provider_history_filters(
    *,
    system_prompt: str,
    conversation: list[dict[str, Any]],
    run_id: UUID,
    tool_history_limit: int,
    thinking_history_limit: int,
    thinking_mode: str,
) -> list[dict[str, Any]]:
    messages = [{"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]}] + list(conversation)
    messages = filter_history_by_run(
        messages,
        current_run_id=str(run_id),
        tool_limit=tool_history_limit,
        thinking_limit=thinking_history_limit,
    )
    return apply_thinking_mode(messages, thinking_mode)


def _split_system_prompt(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    if not messages:
        return "", []
    if messages[0].get("role") != "system":
        return "", list(messages)

    system_parts = messages[0].get("content_parts")
    system_prompt = ""
    if isinstance(system_parts, list):
        system_prompt = "".join(
            str(part.get("text") or "")
            for part in system_parts
            if isinstance(part, dict) and part.get("type") == "content"
        )
    return system_prompt, list(messages[1:])


async def _count_provider_messages_tokens(
    *,
    db: Any,
    run: Any,
    task_config: Any,
    tokenizer_override: str | None,
    messages: list[dict[str, Any]],
) -> int:
    system_prompt, conversation = _split_system_prompt(messages)
    return await count_conversation_tokens(
        db,
        user_id=run.user_id,
        provider=task_config.provider,
        model=task_config.model,
        system_prompt=system_prompt,
        conversation=conversation,
        tokenizer_override=tokenizer_override,
    )


def _context_budget_tokens(task_config: Any) -> int:
    context_window_tokens = int(task_config.context_window_tokens or 0)
    if context_window_tokens <= 0:
        return 0
    reserved_completion = (
        int(task_config.max_output_tokens)
        if task_config.max_output_tokens is not None
        else DEFAULT_RESERVED_COMPLETION
    )
    return context_window_tokens - reserved_completion - ARCHIVE_SAFETY_MARGIN


def _current_run_user_message_id(db: Any, run: Any) -> UUID | None:
    return (
        db.query(RunMessageModel.id)
        .filter(
            RunMessageModel.run_id == run.id,
            RunMessageModel.role == "user",
        )
        .order_by(RunMessageModel.seq.desc())
        .limit(1)
        .scalar()
    )


async def prepare_execution(request: LLMExecutionRequest) -> PreparedLLMExecution:
    db = request.db
    run = request.run
    thread = request.thread
    settings = request.settings
    scenario_bundle = request.scenario_bundle
    input_payload = request.input_payload if isinstance(request.input_payload, dict) else {}
    conversation = request.conversation
    cache_boundaries = list(request.cache_boundaries or [])

    preset_id = settings_service.get_active_preset_id(db, run.user_id)
    if preset_id is None:
        raise RuntimeError("No active preset selected")

    task_type = scenario_bundle.task_type
    runtime = get_llm_runtime(db, user_id=run.user_id, task_type=task_type)
    task_config = runtime.task_config
    tokenizer_override = task_config.advanced.get("tokenizer_override") if isinstance(task_config.advanced, dict) else None

    parent = resolve_parent(db, thread)
    output_mode = resolve_output_mode(
        journey_kind=parent.journey_kind,
        payload=input_payload,
        native_output_mode=bool(getattr(settings, "native_output_mode", False)),
    )

    await mcp_sync_service.sync_stale_tool_servers(
        db,
        user_id=run.user_id,
        preset_id=preset_id,
        thread=thread,
        run=run,
    )

    tool_offer = tool_engine.build_offer_for_run(
        db,
        thread=thread,
        run=run,
        settings=settings,
        preset_id=preset_id,
        user_id=run.user_id,
        project_id=run.project_id,
        input_payload=input_payload,
        vector_storage_enabled=settings_service.is_vector_storage_enabled(db, run.user_id),
    )

    provider = create_llm_provider(
        task_config.provider,
        runtime.provider_config,
        task_config=task_config.__dict__,
    )
    if not provider.validate_config():
        raise RuntimeError(f"Invalid provider configuration: {task_config.provider}")

    native_tool_call_mode = output_mode == "native_tool_call"
    advanced = task_config.advanced if isinstance(task_config.advanced, dict) else {}
    thinking_mode = str(advanced.get("thinking_mode") or "off")
    tool_history_limit = int(getattr(settings, "tool_call_history_limit", 5) or 0)
    thinking_history_limit = int(getattr(settings, "thinking_history_limit", 5) or 0)

    current_system_prompt = request.system_prompt
    current_conversation = annotate_conversation_render_indices(list(conversation))
    current_bundle = scenario_bundle
    provider_messages = _apply_provider_history_filters(
        system_prompt=current_system_prompt,
        conversation=current_conversation,
        run_id=run.id,
        tool_history_limit=tool_history_limit,
        thinking_history_limit=thinking_history_limit,
        thinking_mode=thinking_mode,
    )

    budget_tokens = _context_budget_tokens(task_config)
    if budget_tokens > 0:
        current_run_user_message_id = _current_run_user_message_id(db, run)
        for _ in range(MAX_ARCHIVE_LOOPS):
            total_tokens = await _count_provider_messages_tokens(
                db=db,
                run=run,
                task_config=task_config,
                tokenizer_override=tokenizer_override,
                messages=provider_messages,
            )
            if total_tokens <= budget_tokens:
                break

            await emit_stage(
                request.emit_fn,
                run=run,
                thread=thread,
                stage="summarizing_context",
            )
            boundary = archive_orchestrator.pick_boundary(
                db,
                thread=thread,
                user_id=run.user_id,
                project_id=run.project_id,
                current_run_user_message_id=current_run_user_message_id,
            )
            if boundary is None:
                raise ContextOverflowError(
                    f"Context overflow: no archivable boundary found (tokens={total_tokens}, limit={budget_tokens})"
                )

            await archive_orchestrator.run(
                db,
                run=run,
                thread=thread,
                boundary=boundary,
                scenario_bundle=current_bundle,
            )
            current_system_prompt, current_conversation, current_bundle, cache_boundaries = await prompt_assembly.reassemble_create(
                db,
                run=run,
                thread=thread,
                scenario_bundle=current_bundle,
            )
            current_conversation = annotate_conversation_render_indices(list(current_conversation))
            provider_messages = _apply_provider_history_filters(
                system_prompt=current_system_prompt,
                conversation=current_conversation,
                run_id=run.id,
                tool_history_limit=tool_history_limit,
                thinking_history_limit=thinking_history_limit,
                thinking_mode=thinking_mode,
            )
        else:
            raise ContextOverflowError(f"Could not fit context after {MAX_ARCHIVE_LOOPS} archive cycles")

    if (
        task_config.provider == "custom"
        and thinking_mode == "model"
        and advanced.get("custom_kind") != "openai_response"
    ):
        from ...reasoning.custom_template_runtime import compile_template

        template_id = advanced.get("custom_thinking_template_id")
        if template_id:
            templates = getattr(settings, "custom_thinking_templates", []) or []
            tpl_match = next((t for t in templates if isinstance(t, dict) and t.get("id") == template_id), None)
            if tpl_match:
                thinking_template = compile_template(tpl_match)
                if thinking_template:
                    provider.set_thinking_template(thinking_template)
                    advanced["_resolved_template"] = thinking_template

    provider_settings = advanced.get("provider_settings") if isinstance(advanced.get("provider_settings"), dict) else {}
    provider_cache_settings = (
        dict(provider_settings.get("cache"))
        if isinstance(provider_settings.get("cache"), dict)
        else {}
    )
    prepared_cache_plan = build_prepared_cache_plan(
        db=db,
        thread_id=thread.id,
        provider=task_config.provider,
        model=task_config.model,
        cache_settings=provider_cache_settings,
        cache_boundaries=cache_boundaries,
        provider_messages_with_internal_keys=provider_messages,
    )

    provider_messages = _strip_internal_message_keys(provider_messages)

    if advanced.get("_resolved_template"):
        effective_thinking_config = None
    else:
        effective_thinking_config = advanced.get("thinking_config") if thinking_mode == "model" else None

    stream_thinking_display = provider.get_stream_thinking_display_path(advanced)
    if isinstance(stream_thinking_display, str):
        stream_thinking_display = stream_thinking_display.strip() or None
    else:
        stream_thinking_display = None

    retry_cfg = normalize_retry_config(settings_service.get_retry_config(db, run.user_id))

    return PreparedLLMExecution(
        preset_id=preset_id,
        runtime=runtime,
        task_config=task_config,
        provider=provider,
        tool_offer=tool_offer,
        output_mode=output_mode,
        native_tool_call_mode=native_tool_call_mode,
        advanced=advanced,
        thinking_mode=thinking_mode,
        effective_thinking_config=effective_thinking_config,
        provider_messages=provider_messages,
        prepared_cache_plan=prepared_cache_plan,
        stream_thinking_display=stream_thinking_display,
        retry_cfg=retry_cfg,
    )

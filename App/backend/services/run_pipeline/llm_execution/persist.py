from __future__ import annotations

from typing import Any

from ....models.db_models import RunMessageModel, RunToolCallModel, ThreadPromptCache
from ...reasoning.normalize import normalize_reasoning_detail
from ...prompt_cache_service import touch_thread_prompt_cache, upsert_thread_prompt_cache
from ...run_status_logic import derive_run_status
from ...storage_usage_service import (
    apply_project_usage_delta,
    build_run_message_delta,
    snapshot_run_message_row,
)
from ...token_count_service import count_message_tokens
from .. import raw_output as _raw
from . import events
from .contracts import (
    LLMExecutionCallbacks,
    LLMExecutionRequest,
    PersistedExecutionResult,
    PreparedLLMExecution,
    StreamExecutionResult,
)


def _reasoning_text_from_parts(content_parts: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for part in content_parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "thinking":
            continue
        text = part.get("text")
        if isinstance(text, str) and text:
            chunks.append(text)
    return "".join(chunks)


def _build_custom_reasoning_detail(content_parts: list[dict[str, Any]]) -> dict[str, Any] | None:
    thinking_text = _reasoning_text_from_parts(content_parts)
    if not thinking_text.strip():
        return None
    return normalize_reasoning_detail(
        {
            "type": "custom",
            "meta": {"provider": "custom", "thinking_display": "text"},
            "data": {"text": thinking_text},
            "token_count": 0,
        }
    )


def _content_only_parts(parts: Any) -> list[dict[str, str]]:
    if not isinstance(parts, list):
        return []
    out: list[dict[str, str]] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "content":
            continue
        text = part.get("text")
        if not isinstance(text, str):
            continue
        out.append({"type": "content", "text": text})
    return out


def _cache_metrics_dict(final_snapshot: Any) -> dict[str, Any]:
    return final_snapshot.cache_metrics if isinstance(getattr(final_snapshot, "cache_metrics", None), dict) else {}


def _run_ending_tool_state(
    tool_offer: Any,
    persisted_tools: list[RunToolCallModel],
) -> tuple[str, str | None] | None:
    specs_by_name = getattr(tool_offer, "specs_by_name", {})
    if not isinstance(specs_by_name, dict):
        return None
    ending_names = {
        str(name)
        for name, spec in specs_by_name.items()
        if bool(getattr(spec, "ends_run", False))
    }
    if not ending_names:
        return None
    if not persisted_tools:
        return "error", "Required run-ending tool call was not produced"
    if len(persisted_tools) != 1:
        return "error", "Run-ending journey requires exactly one tool call"

    for row in persisted_tools:
        if str(row.tool_name) not in ending_names:
            return "error", f"Unexpected tool call in run-ending journey: {row.tool_name}"
        if row.status != "applied":
            reason = str(row.reason or "").strip()
            if not reason and isinstance(row.result, dict):
                reason = str(row.result.get("error") or row.result.get("message") or "").strip()
            return "error", reason or f"Run-ending tool {row.tool_name} failed"

    return "done", None


def _touch_selected_prompt_cache_row(db: Any, row_id: Any) -> None:
    if not row_id:
        return
    row = db.query(ThreadPromptCache).filter(ThreadPromptCache.id == row_id).first()
    if row is not None:
        touch_thread_prompt_cache(row)


def _persist_prompt_cache_rows(
    request: LLMExecutionRequest,
    prepared: PreparedLLMExecution,
    final_snapshot: Any,
) -> None:
    cache_plan = getattr(prepared, "prepared_cache_plan", None)
    if cache_plan is None:
        return

    metrics = _cache_metrics_dict(final_snapshot)
    _touch_selected_prompt_cache_row(request.db, getattr(cache_plan, "selected_cache_row_id", None))

    provider = str(getattr(prepared.task_config, "provider", "") or "")
    selected_checkpoint_id = (
        str(metrics.get("selected_checkpoint_id") or getattr(cache_plan, "selected_checkpoint_id", "") or "").strip()
    )
    selected_prefix_digest = (
        str(getattr(cache_plan, "selected_prefix_digest", "") or "").strip()
    )
    ttl_label = str(getattr(cache_plan, "ttl_label", "") or "").strip() or None
    selected_provider_message_count = getattr(cache_plan, "selected_provider_message_count", None)

    if provider == "gemini" and str(getattr(cache_plan, "provider_strategy", "") or "") == "gemini_explicit":
        cache_handle = str(metrics.get("cache_handle") or getattr(cache_plan, "selected_cache_handle", "") or "").strip()
        if cache_handle and selected_checkpoint_id and selected_prefix_digest:
            upsert_thread_prompt_cache(
                request.db,
                thread_id=request.thread.id,
                user_id=request.run.user_id,
                project_id=request.run.project_id,
                provider=provider,
                model=str(prepared.task_config.model),
                checkpoint_id=selected_checkpoint_id,
                prefix_digest=selected_prefix_digest,
                strategy="gemini_cached_content",
                external_handle=cache_handle,
                ttl_label=ttl_label,
                meta={
                    "provider_strategy": getattr(cache_plan, "provider_strategy", None),
                    "selected_provider_message_count": selected_provider_message_count,
                    "cache_metrics": metrics or None,
                },
            )
        return

    if provider == "nanogpt" and str(getattr(cache_plan, "provider_strategy", "") or "") == "nanogpt_single_checkpoint":
        if selected_checkpoint_id and selected_prefix_digest:
            provider_settings = prepared.advanced.get("provider_settings") if isinstance(prepared.advanced, dict) else {}
            cache_settings = provider_settings.get("cache") if isinstance(provider_settings, dict) else {}
            upsert_thread_prompt_cache(
                request.db,
                thread_id=request.thread.id,
                user_id=request.run.user_id,
                project_id=request.run.project_id,
                provider=provider,
                model=str(prepared.task_config.model),
                checkpoint_id=selected_checkpoint_id,
                prefix_digest=selected_prefix_digest,
                strategy="logical_prefix",
                external_handle=None,
                ttl_label=ttl_label,
                meta={
                    "provider_strategy": getattr(cache_plan, "provider_strategy", None),
                    "selected_provider_message_count": selected_provider_message_count,
                    "sticky_provider": bool(cache_settings.get("stickyProvider", False)) if isinstance(cache_settings, dict) else False,
                    "cache_metrics": metrics or None,
                },
            )


async def _fill_reasoning_token_count(
    request: LLMExecutionRequest,
    prepared: PreparedLLMExecution,
    final_snapshot: Any,
) -> int:
    provider = prepared.provider
    task_config = prepared.task_config
    run = request.run

    direct = provider.read_reasoning_tokens(final_snapshot)
    if isinstance(direct, int):
        return max(0, int(direct))

    usage = final_snapshot.usage if isinstance(final_snapshot.usage, dict) else {}
    total_output = int(usage.get("completion_tokens", 0) or 0)

    assistant_output_message = {
        "role": "assistant",
        "content_parts": [
            part
            for part in (final_snapshot.content_parts or [])
            if isinstance(part, dict) and part.get("type") == "content"
        ],
        "tool_calls": [
            {
                "id": str(tc.id),
                "type": "function",
                "function": {
                    "name": str(tc.tool_name),
                    "arguments": tc.raw_arguments,
                },
                **({"extra_content": tc.extra_content} if isinstance(tc.extra_content, dict) else {}),
            }
            for tc in (final_snapshot.tool_calls or [])
        ],
    }

    advanced = task_config.advanced if isinstance(getattr(task_config, "advanced", None), dict) else {}
    tokenizer_override_raw = advanced.get("tokenizer_override")
    tokenizer_override = tokenizer_override_raw if isinstance(tokenizer_override_raw, str) else None
    variant_hint_raw = advanced.get("custom_kind")
    variant_hint = variant_hint_raw if isinstance(variant_hint_raw, str) else None
    try:
        non_reasoning_tokens = await count_message_tokens(
            request.db,
            user_id=run.user_id,
            provider=task_config.provider,
            model=task_config.model,
            message=assistant_output_message,
            tokenizer_override=tokenizer_override,
            variant_hint=variant_hint,
        )
    except Exception:
        return 0

    estimated = total_output - int(non_reasoning_tokens)
    if estimated < 0:
        estimated = 0
    return int(estimated)


async def persist_execution(
    request: LLMExecutionRequest,
    callbacks: LLMExecutionCallbacks,
    prepared: PreparedLLMExecution,
    stream_result: StreamExecutionResult,
    *,
    assistant_message: RunMessageModel,
) -> PersistedExecutionResult:
    db = request.db
    run = request.run
    thread = request.thread
    final_snapshot = stream_result.final_snapshot

    if prepared.output_mode == "raw_output" and final_snapshot.tool_calls:
        raise RuntimeError("Raw output mode cannot include tool calls")

    reasoning_detail: dict[str, Any] | None = None
    if prepared.thinking_mode == "custom":
        reasoning_detail = _build_custom_reasoning_detail(final_snapshot.content_parts)
    elif prepared.thinking_mode == "model":
        reasoning_detail = normalize_reasoning_detail(prepared.provider.read_reasoning_detail(final_snapshot, prepared.advanced))

    if reasoning_detail is not None:
        reasoning_detail["token_count"] = await _fill_reasoning_token_count(
            request,
            prepared,
            final_snapshot,
        )

    _persist_prompt_cache_rows(request, prepared, final_snapshot)

    db.refresh(run)
    db.refresh(thread)
    assistant_message = db.query(RunMessageModel).filter(RunMessageModel.id == assistant_message.id).first()
    if assistant_message is None:
        raise RuntimeError("Assistant message row missing")

    content_only_parts = _content_only_parts(final_snapshot.content_parts)
    language_entry: dict[str, Any] = {"contentParts": content_only_parts}
    if reasoning_detail is not None:
        language_entry["reasoningDetail"] = reasoning_detail
    assistant_message_before = snapshot_run_message_row(assistant_message)
    assistant_message.data = {
        run.language: language_entry,
    }
    assistant_message_delta = build_run_message_delta(
        assistant_message_before,
        snapshot_run_message_row(assistant_message),
    )
    assistant_message_delta_applied = False

    persisted_tools: list[RunToolCallModel] = []
    if prepared.output_mode == "raw_output":
        run.status = "processing"
        thread.status = "processing"
        apply_project_usage_delta(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            delta=assistant_message_delta,
            enforce_quota=True,
        )
        assistant_message_delta_applied = True
        db.commit()
        await events.emit_run_status(
            callbacks,
            run=run,
            thread=thread,
            status="processing",
            error=None,
        )
        await callbacks.sync_status_fn(
            db=db,
            run=run,
            thread=thread,
            error=None,
            emit_run_status=False,
        )
        await _raw.apply_raw_output(
            db,
            thread=thread,
            run=run,
            input_payload=request.input_payload if isinstance(request.input_payload, dict) else {},
            content_parts=content_only_parts,
            emit_fn=callbacks.emit_fn,
        )
    else:
        persisted_tools = await callbacks.persist_tool_calls_fn(
            db,
            thread=thread,
            run=run,
            assistant_message=assistant_message,
            tool_calls=final_snapshot.tool_calls,
            offer=prepared.tool_offer,
            preset_id=prepared.preset_id,
        )

    run_ending_state = _run_ending_tool_state(getattr(prepared, "tool_offer", None), persisted_tools)
    if run_ending_state is not None:
        terminal_status, terminal_error = run_ending_state
        run.status = terminal_status
        run.error = terminal_error
        thread.status = terminal_status
    else:
        derived = derive_run_status(
            current_status=run.status,
            tool_call_statuses=[tc.status for tc in persisted_tools],
        )
        if derived:
            run.status = derived
            thread.status = derived

    if not assistant_message_delta_applied:
        apply_project_usage_delta(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            delta=assistant_message_delta,
            enforce_quota=True,
        )
    db.commit()
    request.checkpoint.finalized = True

    tool_call_summaries: list[dict[str, Any]] = [
        {
            "tool_call_id": str(row.id),
            "message_id": str(row.message_id),
            "assistant_message_id": str(row.assistant_message_id),
            "index": idx,
            "name": row.tool_name,
            "arguments": row.arguments,
            "extra_content": row.extra_content if isinstance(row.extra_content, dict) else None,
            "status": row.status,
            "reason": row.reason,
            "seq_in_thread": int(row.message.seq_in_thread) if row.message else 0,
        }
        for idx, row in enumerate(persisted_tools)
    ]

    return PersistedExecutionResult(
        assistant_message=assistant_message,
        tool_call_summaries=tool_call_summaries,
    )

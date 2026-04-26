from __future__ import annotations

from ....providers.shared.parsing.content_normalization import (
    StreamContentNormalizer,
    has_effective_delta,
    normalize_final_snapshot_content,
)
from ....providers.shared.contracts import (
    DeltaPayload,
    MetaPayload,
    ProviderErrorPayload,
    extract_native_tool_calls_from_snapshot,
    merge_meta_payload,
    patch_snapshot_with_meta,
)
from ....providers.shared.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler
from ....providers.shared.transport.stream_retry import stream_with_retry
from . import events
from .contracts import LLMExecutionCallbacks, LLMExecutionRequest, PreparedLLMExecution, StreamExecutionResult
from .request_session import LLMRequestSession
from .tool_delta_tracker import ToolDeltaTracker


async def execute_stream(
    request: LLMExecutionRequest,
    callbacks: LLMExecutionCallbacks,
    prepared: PreparedLLMExecution,
    *,
    assistant_message,
    request_id: str,
) -> StreamExecutionResult:
    run = request.run
    thread = request.thread
    provider = prepared.provider
    task_config = prepared.task_config
    advanced = prepared.advanced
    prepared_cache_plan = getattr(prepared, "prepared_cache_plan", None)

    def _create_stream():
        if prepared.output_mode == "raw_output":
            tools_wire = None
        elif prepared.native_tool_call_mode:
            tools_wire = None
        else:
            tools_wire = prepared.tool_offer.provider_tools

        return provider.stream_chat(
            messages=prepared.provider_messages,
            model=task_config.model,
            temperature=float(task_config.temperature),
            tools=tools_wire,
            tool_choice="auto" if tools_wire else None,
            max_tokens=task_config.max_output_tokens,
            provider_preference=getattr(task_config, "provider_preference", None),
            thinking_config=prepared.effective_thinking_config,
            thinking_mode=prepared.thinking_mode,
            custom_kind=advanced.get("custom_kind"),
            native_tool_call=prepared.native_tool_call_mode,
            verbosity=advanced.get("verbosity"),
            provider_settings=advanced.get("provider_settings"),
            cache_plan=prepared_cache_plan,
        )

    session = LLMRequestSession(
        request_id=request_id,
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        run_id=run.id,
        assistant_message_id=assistant_message.id,
        provider=task_config.provider,
        model=task_config.model,
        logging_enabled=bool(getattr(request.settings, "llm_logging_enabled", False)),
    )

    async def _on_retry(message: str, status: int | None, _attempt: int) -> None:
        session.on_retry(message, status)

    stream = stream_with_retry(_create_stream, prepared.retry_cfg, on_retry=_on_retry)
    assembler = FallbackSnapshotAssembler(provider=task_config.provider, model=task_config.model)
    content_normalizer = StreamContentNormalizer()
    tool_tracker = ToolDeltaTracker(
        callbacks=callbacks,
        run=run,
        thread=thread,
        assistant_message=assistant_message,
        request_id=request_id,
    )
    native_final = None
    seed_cache_metrics = (
        prepared_cache_plan.as_metrics()
        if prepared_cache_plan is not None and hasattr(prepared_cache_plan, "as_metrics")
        else None
    )
    merged_meta: MetaPayload | None = MetaPayload(cache_metrics=seed_cache_metrics)
    raw_response: dict | None = None

    try:
        async for event in stream:
            if event.raw_request is not None:
                session.on_request(event.raw_request)
                await events.emit_llm_request(
                    callbacks,
                    run=run,
                    thread=thread,
                    assistant_message=assistant_message,
                    request_id=request_id,
                    retry_count=session.retry_count,
                    provider=task_config.provider,
                    model=task_config.model,
                    raw_request=event.raw_request,
                )
                continue

            if event.raw_response is not None:
                raw_response = event.raw_response

            if event.kind == "delta" and event.delta is not None:
                delta: DeltaPayload = content_normalizer.normalize_delta(event.delta)
                assembler.apply_delta(delta)
                if not has_effective_delta(delta):
                    continue

                if delta.content_delta:
                    await events.emit_content_delta(
                        callbacks,
                        run=run,
                        thread=thread,
                        assistant_message=assistant_message,
                        request_id=request_id,
                        text=delta.content_delta,
                    )

                if prepared.thinking_mode != "off" and delta.thinking_delta and prepared.stream_thinking_display:
                    await events.emit_thinking_delta(
                        callbacks,
                        run=run,
                        thread=thread,
                        assistant_message=assistant_message,
                        request_id=request_id,
                        text=delta.thinking_delta,
                        thinking_display=prepared.stream_thinking_display,
                    )

                await tool_tracker.apply(delta.tool_call_deltas)
            elif event.kind == "meta" and event.meta is not None:
                assembler.apply_meta(event.meta)
                merged_meta = merge_meta_payload(merged_meta, event.meta)
            elif event.kind == "final_native" and event.final_native is not None:
                native_final = event.final_native
            elif event.kind == "error":
                err: ProviderErrorPayload = event.error or ProviderErrorPayload(message="Unknown provider error", status=None)
                session.fail(
                    err.message,
                    content_parts=assembler._content_parts,
                    merged_meta=merged_meta,
                )
                raise RuntimeError(err.message)
    except Exception as exc:
        session.fail(
            str(exc),
            content_parts=assembler._content_parts,
            merged_meta=merged_meta,
        )
        raise

    try:
        if native_final is not None:
            final_snapshot = patch_snapshot_with_meta(native_final, merged_meta)
        else:
            final_snapshot = assembler.finalize_or_raise()

        if raw_response is not None and final_snapshot.raw_native_response is None:
            final_snapshot.raw_native_response = raw_response

        if prepared.native_tool_call_mode:
            final_snapshot = extract_native_tool_calls_from_snapshot(final_snapshot)
        final_snapshot = normalize_final_snapshot_content(final_snapshot)
    except Exception as exc:
        session.fail(
            str(exc),
            content_parts=assembler._content_parts,
            merged_meta=merged_meta,
        )
        raise

    session.complete(final_snapshot.raw_native_response or raw_response, merged_meta)
    return StreamExecutionResult(
        final_snapshot=final_snapshot,
        raw_response=raw_response,
        request_id=request_id,
    )

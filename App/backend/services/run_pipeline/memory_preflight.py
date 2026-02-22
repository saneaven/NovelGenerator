from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread
from ...providers.contracts import ProviderErrorPayload, merge_meta_payload, patch_snapshot_with_meta, MetaPayload
from ...providers.fallback_snapshot_assembler import FallbackSnapshotAssembler
from ...providers.registry import ProviderRegistry
from ..credential_service import credential_service
from ..memory_builder import render_memory_summary_prompt
from ..memory_service import archive_thread_until, get_thread_memory_status
from ..prompt_runtime.prompt_manager import PromptBundle
from ..prompt_runtime.prompt_renderer import PromptRenderer
from ..settings_service import settings_service
from .text_utils import (
    build_archive_payload_for_message,
    count_tokens,
    format_summary_message_content,
    serialize_active_message_for_budget,
)

MEMORY_PREFLIGHT_MAX_ARCHIVE_LOOPS = 3
MEMORY_PREFLIGHT_SAFETY_MARGIN = 256
MEMORY_PREFLIGHT_DEFAULT_RESERVED_COMPLETION = 2048


async def run_summary_model(
    db: Session,
    *,
    user_id: UUID,
    system_prompt: str,
    user_prompt: str,
) -> str:
    summary_cfg = settings_service.get_task_config(db, user_id, "summary")
    provider_config = credential_service.get_provider_config(db, user_id, summary_cfg.provider)
    if summary_cfg.provider == "custom":
        provider_config = {
            **provider_config,
            "request_format": summary_cfg.advanced.get("request_format") or "openai_sdk",
        }

    provider = ProviderRegistry.get_provider(summary_cfg.provider, provider_config)
    if not provider.validate_config():
        raise RuntimeError(f"Invalid summary provider configuration: {summary_cfg.provider}")

    stream = provider.stream_chat(
        messages=[
            {"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]},
            {"role": "user", "content_parts": [{"type": "content", "text": user_prompt}]},
        ],
        model=summary_cfg.model,
        temperature=float(summary_cfg.temperature),
        tools=None,
        tool_choice=None,
        max_tokens=summary_cfg.max_output_tokens,
        provider_preference=summary_cfg.advanced.get("provider_preference") if isinstance(summary_cfg.advanced, dict) else None,
        thinking_config=summary_cfg.advanced.get("thinking_config") if isinstance(summary_cfg.advanced, dict) else None,
        thinking_mode=summary_cfg.advanced.get("thinking_mode") if isinstance(summary_cfg.advanced, dict) else "off",
        request_format=summary_cfg.advanced.get("request_format") if isinstance(summary_cfg.advanced, dict) else None,
        retry_config=settings_service.get_retry_config(db, user_id),
        native_tool_call=False,
    )

    assembler = FallbackSnapshotAssembler(provider=summary_cfg.provider, model=summary_cfg.model)
    native_final = None
    merged_meta: MetaPayload | None = None

    async for event in stream:
        if event.kind == "delta" and event.delta is not None:
            assembler.apply_delta(event.delta)
        elif event.kind == "meta" and event.meta is not None:
            assembler.apply_meta(event.meta)
            merged_meta = merge_meta_payload(merged_meta, event.meta)
        elif event.kind == "final_native" and event.final_native is not None:
            native_final = event.final_native
        elif event.kind == "error":
            err = event.error or ProviderErrorPayload(message="Unknown provider error", status=None)
            raise RuntimeError(err.message)

    if hasattr(stream, "aclose"):
        await stream.aclose()

    if native_final is not None:
        final_snapshot = patch_snapshot_with_meta(native_final, merged_meta)
    else:
        final_snapshot = assembler.finalize_or_raise()

    summary_text = "".join(
        str(part.get("text") or "")
        for part in final_snapshot.content_parts
        if isinstance(part, dict) and str(part.get("type") or "") == "content"
    ).strip()
    if not summary_text:
        raise RuntimeError("Summary model returned empty content")
    return summary_text


async def prepare_thread_memory_preflight(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    task_config: Any,
    tokenizer_override: str | None,
    prompt_bundle: PromptBundle,
    renderer: PromptRenderer,
) -> None:
    context_window_tokens = int(task_config.context_window_tokens or 32000)
    reserved_completion = (
        int(task_config.max_output_tokens)
        if task_config.max_output_tokens is not None
        else MEMORY_PREFLIGHT_DEFAULT_RESERVED_COMPLETION
    )
    budget_tokens = context_window_tokens - reserved_completion - MEMORY_PREFLIGHT_SAFETY_MARGIN
    if budget_tokens <= 0:
        return

    for _ in range(MEMORY_PREFLIGHT_MAX_ARCHIVE_LOOPS):
        status = get_thread_memory_status(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            language=run.language,
        )
        boundary_seq = status.get("archivedUntilSeqInThread")
        active_q = (
            db.query(RunMessageModel)
            .filter(RunMessageModel.thread_id == thread.id)
            .order_by(RunMessageModel.seq_in_thread.asc(), RunMessageModel.created_at.asc())
        )
        if boundary_seq is not None:
            active_q = active_q.filter(RunMessageModel.seq_in_thread > int(boundary_seq))
        active_messages = active_q.all()
        if not active_messages:
            return

        assistant_ids = [msg.id for msg in active_messages if msg.role == "assistant"]
        tool_calls_by_assistant: dict[UUID, list[RunToolCallModel]] = {}
        if assistant_ids:
            tc_rows = (
                db.query(RunToolCallModel)
                .filter(
                    RunToolCallModel.thread_id == thread.id,
                    RunToolCallModel.assistant_message_id.in_(assistant_ids),
                )
                .order_by(RunToolCallModel.call_seq.asc())
                .all()
            )
            for row in tc_rows:
                if row.assistant_message_id is None:
                    continue
                tool_calls_by_assistant.setdefault(row.assistant_message_id, []).append(row)

        token_map: dict[UUID, int] = {}
        active_total_tokens = 0
        for msg in active_messages:
            row_text = serialize_active_message_for_budget(
                message=msg,
                language=run.language,
                tool_calls=tool_calls_by_assistant.get(msg.id, []),
            )
            row_tokens = await count_tokens(
                db,
                user_id=run.user_id,
                provider=task_config.provider,
                model=task_config.model,
                text=row_text,
                tokenizer_override=tokenizer_override,
            )
            token_map[msg.id] = row_tokens
            active_total_tokens += row_tokens

        if active_total_tokens <= budget_tokens:
            return

        current_user_message_id: UUID | None = None
        if active_messages:
            last_active = active_messages[-1]
            if last_active.run_id == run.id and last_active.role == "user":
                current_user_message_id = last_active.id

        archivable_messages = [
            msg
            for msg in active_messages
            if current_user_message_id is None or msg.id != current_user_message_id
        ]
        if not archivable_messages:
            return

        overflow = active_total_tokens - budget_tokens
        removed_tokens = 0
        boundary_message_id: UUID | None = None
        for msg in archivable_messages:
            removed_tokens += int(token_map.get(msg.id, 0))
            boundary_message_id = msg.id
            if removed_tokens >= overflow:
                break
        if boundary_message_id is None:
            return

        boundary_index = next(
            (idx for idx, msg in enumerate(active_messages) if msg.id == boundary_message_id),
            -1,
        )
        if boundary_index < 0:
            return
        archive_rows = active_messages[: boundary_index + 1]
        if not archive_rows:
            return

        archived_messages_payload: list[dict[str, Any]] = []
        summary_messages: list[dict[str, Any]] = []
        for msg in archive_rows:
            tool_calls = tool_calls_by_assistant.get(msg.id, [])
            payload = build_archive_payload_for_message(
                message=msg,
                language=run.language,
                tool_calls=tool_calls,
            )
            archived_messages_payload.append(payload)
            summary_messages.append(
                {
                    "role": msg.role,
                    "content": format_summary_message_content(
                        content=str(payload.get("content") or ""),
                        tool_calls=tool_calls,
                    ),
                    "messageId": str(msg.id),
                    "createdAt": msg.created_at.isoformat() if msg.created_at else None,
                }
            )

        project_data = prompt_bundle.template_data.get("project")
        if not isinstance(project_data, dict):
            project_data = {}
        variables = prompt_bundle.template_data.get("variables")
        if not isinstance(variables, dict):
            variables = {}

        summary_system_prompt, summary_user_prompt = render_memory_summary_prompt(
            renderer,
            project_data=project_data,
            language=run.language,
            previous_summary=str(status.get("lastSummaryText") or ""),
            archive_until_message_id=str(boundary_message_id),
            messages=summary_messages,
            variables=variables,
        )
        summary_text = await run_summary_model(
            db,
            user_id=run.user_id,
            system_prompt=summary_system_prompt,
            user_prompt=summary_user_prompt,
        )
        await archive_thread_until(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            language=run.language,
            archive_until_message_id=boundary_message_id,
            summary_text=summary_text,
            archived_messages=archived_messages_payload,
        )

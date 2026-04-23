from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageAttachmentModel, RunMessageModel, RunModel, RunToolCallModel, Thread
from ...models.memory_models import MessageSemanticSource
from ...providers.shared.parsing.multimodal import attachment_to_content_part
from ...providers.shared.transport.stream_retry import normalize_retry_config
from ..credential_service import credential_service
from ..embedding_config_service import get_embedding_profile
from ..llm_runtime_service import get_llm_runtime
from ..prompt_runtime.contracts import ScenarioBundle
from ..prompt_runtime.scenario_manager import ScenarioManager
from ..run_pipeline.text_utils import extract_message_content_text, tool_call_result_text
from ..settings_service import settings_service
from . import state
from .errors import EmbeddingUnavailable, MemoryArchiveError
from .summary_pipeline import summarize
from .vector_pipeline import ExistingSourceState, chunk_and_embed


@dataclass(frozen=True)
class BoundaryChoice:
    message_id: UUID
    role: str
    seq_in_thread: int


def _pick_boundary_from_rows(
    rows: list[BoundaryChoice],
    *,
    current_run_user_message_id: UUID | None,
) -> BoundaryChoice | None:
    if len(rows) <= 1:
        return None

    cut_idx = max(0, len(rows) // 2 - 1)
    while cut_idx >= 0 and rows[cut_idx].message_id == current_run_user_message_id:
        cut_idx -= 1
    if cut_idx < 0:
        return None
    return rows[cut_idx]


def _attachment_payload(attachment: RunMessageAttachmentModel) -> dict[str, Any]:
    part = attachment_to_content_part(attachment)
    return {
        "type": str(part.get("type") or ""),
        "mime_type": str(part.get("mime_type") or ""),
        "filename": str(part.get("filename") or ""),
        "storage_key": str(part.get("storage_key") or ""),
    }


def _tool_call_payload(tool_call: RunToolCallModel) -> dict[str, Any]:
    return {
        "id": str(tool_call.llm_call_id or tool_call.id),
        "name": str(tool_call.tool_name or ""),
        "status": str(tool_call.status or ""),
        "arguments": tool_call.arguments if isinstance(tool_call.arguments, dict) else {},
        "result": tool_call.result if tool_call.result is not None else "",
        "reason": str(tool_call.reason or ""),
    }


def _attachment_summary_text(attachments: list[RunMessageAttachmentModel]) -> str:
    lines: list[str] = []
    for attachment in attachments:
        part = attachment_to_content_part(attachment)
        filename = str(part.get("filename") or "").strip() or "attachment"
        part_type = str(part.get("type") or "").strip() or "file"
        mime_type = str(part.get("mime_type") or "").strip()
        label = f"[Attached {part_type}: {filename}]"
        if mime_type:
            label = f"{label} ({mime_type})"
        lines.append(label)
    return "\n".join(lines)


def _format_summary_message_content(
    *,
    content: str,
    tool_calls: list[RunToolCallModel],
    attachments: list[RunMessageAttachmentModel],
) -> str:
    chunks: list[str] = []
    if content:
        chunks.append(content)
    attachment_text = _attachment_summary_text(attachments)
    if attachment_text:
        chunks.append(attachment_text)
    for tool_call in tool_calls:
        result = tool_call_result_text(tool_call)
        chunks.append(
            "\n".join(
                [
                    f"[Tool: {tool_call.tool_name}]",
                    f"Arguments: {json.dumps(tool_call.arguments if isinstance(tool_call.arguments, dict) else {}, ensure_ascii=False)}",
                    f"Result: {result}",
                ]
            ).strip()
        )
    return "\n\n".join(chunk for chunk in chunks if chunk).strip()


def build_archive_payload(
    db: Session,
    *,
    thread: Thread,
    boundary: BoundaryChoice,
    archived_until_seq_in_thread: int | None,
    language: str,
) -> dict[str, Any]:
    query = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.thread_id == thread.id)
        .filter(RunMessageModel.seq_in_thread <= boundary.seq_in_thread)
        .order_by(RunMessageModel.seq_in_thread.asc(), RunMessageModel.created_at.asc())
    )
    if archived_until_seq_in_thread is not None:
        query = query.filter(RunMessageModel.seq_in_thread > int(archived_until_seq_in_thread))
    rows = query.all()
    if not rows:
        raise MemoryArchiveError("No messages selected for archive")

    message_ids = [row.id for row in rows if isinstance(row.id, UUID)]
    assistant_ids = [row.id for row in rows if row.role == "assistant"]

    attachments_by_message: dict[UUID, list[RunMessageAttachmentModel]] = {}
    if message_ids:
        attachment_rows = (
            db.query(RunMessageAttachmentModel)
            .filter(RunMessageAttachmentModel.message_id.in_(message_ids))
            .order_by(RunMessageAttachmentModel.message_id.asc(), RunMessageAttachmentModel.sort_order.asc())
            .all()
        )
        for attachment in attachment_rows:
            attachments_by_message.setdefault(attachment.message_id, []).append(attachment)

    tool_calls_by_assistant: dict[UUID, list[RunToolCallModel]] = {}
    if assistant_ids:
        tool_rows = (
            db.query(RunToolCallModel)
            .filter(
                RunToolCallModel.thread_id == thread.id,
                RunToolCallModel.assistant_message_id.in_(assistant_ids),
            )
            .order_by(RunToolCallModel.call_seq.asc())
            .all()
        )
        for tool in tool_rows:
            if tool.assistant_message_id is None:
                continue
            tool_calls_by_assistant.setdefault(tool.assistant_message_id, []).append(tool)

    payload_messages: list[dict[str, Any]] = []
    summary_messages: list[dict[str, Any]] = []
    for row in rows:
        attachments = attachments_by_message.get(row.id, [])
        tool_calls = tool_calls_by_assistant.get(row.id, [])
        content = extract_message_content_text(row.data if isinstance(row.data, dict) else {}, language)
        message_payload = {
            "message_id": row.id,
            "role": row.role,
            "seq_in_thread": int(row.seq_in_thread),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "content": content,
            "tool_calls": [_tool_call_payload(tool_call) for tool_call in tool_calls],
            "attachments": [_attachment_payload(attachment) for attachment in attachments],
        }
        payload_messages.append(message_payload)
        summary_messages.append(
            {
                "role": row.role,
                "content": _format_summary_message_content(
                    content=content,
                    tool_calls=tool_calls,
                    attachments=attachments,
                ),
                "messageId": str(row.id),
                "createdAt": row.created_at.isoformat() if row.created_at else None,
            }
        )

    return {
        "boundary_message_id": boundary.message_id,
        "boundary_seq_in_thread": boundary.seq_in_thread,
        "messages": payload_messages,
        "summary_messages": summary_messages,
    }


def pick_boundary(
    db: Session,
    *,
    thread: Thread,
    user_id: UUID,
    project_id: UUID,
    current_run_user_message_id: UUID | None,
) -> BoundaryChoice | None:
    latest_archived = state.latest_archived_seq(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread.id,
    )
    query = (
        db.query(RunMessageModel.id, RunMessageModel.role, RunMessageModel.seq_in_thread)
        .filter(RunMessageModel.thread_id == thread.id)
        .order_by(RunMessageModel.seq_in_thread.asc())
    )
    if latest_archived is not None:
        query = query.filter(RunMessageModel.seq_in_thread > int(latest_archived))
    rows = [
        BoundaryChoice(
            message_id=row.id,
            role=str(row.role or ""),
            seq_in_thread=int(row.seq_in_thread),
        )
        for row in query.all()
        if row.id is not None and row.seq_in_thread is not None
    ]
    return _pick_boundary_from_rows(
        rows,
        current_run_user_message_id=current_run_user_message_id,
    )


async def run(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    boundary: BoundaryChoice,
    scenario_bundle: ScenarioBundle,
) -> None:
    preset_id = settings_service.get_active_preset_id(db, run.user_id)
    if preset_id is None:
        raise MemoryArchiveError("No active preset selected")

    archive_state = state.get_archive_state(
        db,
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        language=run.language,
    )
    slice_payload = build_archive_payload(
        db,
        thread=thread,
        boundary=boundary,
        archived_until_seq_in_thread=archive_state.archived_until_seq_in_thread,
        language=run.language,
    )

    embedding_profile = get_embedding_profile(db, user_id=run.user_id, feature="memory")
    if embedding_profile is None:
        raise EmbeddingUnavailable("Missing agent-memory embedding profile")

    summary_runtime = get_llm_runtime(db, user_id=run.user_id, task_type="summary")
    retry_cfg = normalize_retry_config(settings_service.get_retry_config(db, run.user_id))
    summary_scenario = ScenarioManager.load_active_scenario(
        db,
        user_id=run.user_id,
        preset_id=preset_id,
        task_type="memory",
        task_subtype="summary",
    )
    embed_provider_cfg = credential_service.get_provider_config(
        db,
        run.user_id,
        str(embedding_profile["provider"]),
    )

    message_ids = [
        item["message_id"]
        for item in slice_payload.get("messages") or []
        if isinstance(item, dict) and isinstance(item.get("message_id"), UUID)
    ]
    existing_rows = []
    if message_ids:
        existing_rows = (
            db.query(MessageSemanticSource)
            .filter(
                MessageSemanticSource.user_id == run.user_id,
                MessageSemanticSource.project_id == run.project_id,
                MessageSemanticSource.thread_id == thread.id,
                MessageSemanticSource.message_id.in_(message_ids),
                MessageSemanticSource.language == run.language,
            )
            .all()
        )
    existing_sources = {
        row.message_id: ExistingSourceState(
            content_hash=row.content_hash,
            index_state=str(row.index_state or ""),
        )
        for row in existing_rows
        if isinstance(row.message_id, UUID)
    }

    try:
        summary_text, vector_batch = await asyncio.gather(
            summarize(
                slice_payload=slice_payload,
                previous_summary=archive_state.previous_summary,
                project_data=scenario_bundle.project_data,
                language=run.language,
                template_renderer=scenario_bundle.template_renderer_factory(),
                summary_scenario=summary_scenario,
                variables=(
                    scenario_bundle.template_data.get("variables")
                    if isinstance(scenario_bundle.template_data, dict)
                    else None
                ),
                runtime=summary_runtime,
                retry_cfg=retry_cfg,
            ),
            chunk_and_embed(
                slice_payload=slice_payload,
                language=run.language,
                embedding_profile=embedding_profile,
                provider_config=embed_provider_cfg,
                existing_sources=existing_sources,
            ),
        )
    except MemoryArchiveError:
        raise
    except Exception as exc:
        raise MemoryArchiveError(str(exc) or "Memory archive failed") from exc

    try:
        state.write_summary_row(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            language=run.language,
            boundary_message_id=boundary.message_id,
            boundary_seq_in_thread=boundary.seq_in_thread,
            summary_text=summary_text,
        )
        state.upsert_vector_sources(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            language=run.language,
            vector_batch=vector_batch,
        )
        thread.captured_history_system_prompt = None
        thread.captured_history_conversation_json = None
        thread.captured_history_cache_plan_json = None
        db.commit()
    except Exception as exc:
        db.rollback()
        raise MemoryArchiveError(str(exc) or "Memory archive commit failed") from exc

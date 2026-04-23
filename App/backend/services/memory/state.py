from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import desc
from sqlalchemy.orm import Session

from ...models.memory_models import MessageMemorySummary, MessageSemanticChunk, MessageSemanticSource
from ..embedding_config_service import set_embedding_dimensions
from .vector_pipeline import VectorBatch


@dataclass(frozen=True)
class MemoryArchiveState:
    archived_until_message_id: UUID | None
    archived_until_seq_in_thread: int | None
    previous_summary: str


def _latest_summary_query(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
):
    return db.query(MessageMemorySummary).filter(
        MessageMemorySummary.user_id == user_id,
        MessageMemorySummary.project_id == project_id,
        MessageMemorySummary.thread_id == thread_id,
    )


def latest_summary(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str | None = None,
    prefer_language: bool = False,
) -> MessageMemorySummary | None:
    base_q = _latest_summary_query(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
    )
    if prefer_language and language:
        preferred = (
            base_q.filter(MessageMemorySummary.language == language)
            .order_by(
                desc(MessageMemorySummary.to_seq_in_thread),
                desc(MessageMemorySummary.created_at),
            )
            .first()
        )
        if preferred is not None:
            return preferred
    return (
        base_q.order_by(
            desc(MessageMemorySummary.to_seq_in_thread),
            desc(MessageMemorySummary.created_at),
        )
        .first()
    )


def latest_archived_seq(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
) -> int | None:
    row = latest_summary(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
    )
    if row is None or row.to_seq_in_thread is None:
        return None
    return int(row.to_seq_in_thread)


def get_previous_summary(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
) -> str:
    row = latest_summary(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
        prefer_language=True,
    )
    return str(getattr(row, "summary_text", "") or "")


def get_archive_state(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
) -> MemoryArchiveState:
    boundary = latest_summary(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
    )
    previous_summary = get_previous_summary(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
    )
    return MemoryArchiveState(
        archived_until_message_id=getattr(boundary, "to_message_id", None),
        archived_until_seq_in_thread=(
            int(boundary.to_seq_in_thread)
            if boundary is not None and boundary.to_seq_in_thread is not None
            else None
        ),
        previous_summary=previous_summary,
    )


def write_summary_row(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
    boundary_message_id: UUID,
    boundary_seq_in_thread: int,
    summary_text: str,
) -> MessageMemorySummary:
    row = MessageMemorySummary(
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
        to_message_id=boundary_message_id,
        to_seq_in_thread=int(boundary_seq_in_thread),
        summary_text=str(summary_text or "").strip(),
        created_at=datetime.utcnow(),
    )
    db.add(row)
    return row


def upsert_vector_sources(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
    vector_batch: VectorBatch,
) -> int:
    indexed_count = 0
    now = datetime.utcnow()

    first_embedding_dim: int | None = None
    for source_payload in vector_batch.upserts:
        if source_payload.chunks:
            first_embedding_dim = len(source_payload.chunks[0].embedding)
            break

    if first_embedding_dim is not None:
        stored_dim = vector_batch.profile_dimensions
        if stored_dim is None:
            set_embedding_dimensions(db, user_id=user_id, feature="memory", dimensions=first_embedding_dim)
        elif stored_dim != first_embedding_dim:
            raise RuntimeError(f"Embedding dimensions mismatch (profile={stored_dim}, got={first_embedding_dim})")

    for source_payload in vector_batch.upserts:
        source = (
            db.query(MessageSemanticSource)
            .filter(
                MessageSemanticSource.user_id == user_id,
                MessageSemanticSource.project_id == project_id,
                MessageSemanticSource.thread_id == thread_id,
                MessageSemanticSource.message_id == source_payload.message_id,
                MessageSemanticSource.language == language,
            )
            .first()
        )
        if source is None:
            source = MessageSemanticSource(
                user_id=user_id,
                project_id=project_id,
                thread_id=thread_id,
                message_id=source_payload.message_id,
                language=language,
                content_hash=source_payload.content_hash,
                index_state="ready",
                indexed_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(source)
        else:
            source.content_hash = source_payload.content_hash
            source.index_state = "ready"
            source.indexed_at = now
            source.updated_at = now
            source.chunks = []

        for chunk in source_payload.chunks:
            source.chunks.append(
                MessageSemanticChunk(
                    chunk_index=chunk.chunk_index,
                    field_path=chunk.field_path,
                    text=chunk.text,
                    embedding=chunk.embedding,
                    embedding_dim=len(chunk.embedding),
                    created_at=now,
                )
            )
            indexed_count += 1

    return indexed_count

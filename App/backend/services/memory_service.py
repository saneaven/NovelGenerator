from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from ..models.db_models import RunMessageModel
from ..models.memory_models import MessageMemorySummary, MessageSemanticSource
from .credential_service import credential_service
from .embedding_config_service import get_embedding_profile
from .memory import state as memory_state
from .semantic_embedding_service import embed_many
from .settings_service import settings_service


def wipe_memory_index(db: Session, *, user_id: UUID) -> None:
    db.query(MessageSemanticSource).filter(MessageSemanticSource.user_id == user_id).delete(synchronize_session=False)


def get_thread_memory_status(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
) -> dict[str, Any]:
    summary_count = (
        db.query(MessageMemorySummary)
        .filter(
            MessageMemorySummary.user_id == user_id,
            MessageMemorySummary.project_id == project_id,
            MessageMemorySummary.thread_id == thread_id,
            MessageMemorySummary.language == language,
        )
        .count()
    )
    if summary_count == 0:
        summary_count = (
            db.query(MessageMemorySummary)
            .filter(
                MessageMemorySummary.user_id == user_id,
                MessageMemorySummary.project_id == project_id,
                MessageMemorySummary.thread_id == thread_id,
            )
            .count()
        )

    last = memory_state.latest_summary(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
        prefer_language=True,
    )
    indexed = (
        db.query(MessageSemanticSource)
        .filter(
            MessageSemanticSource.user_id == user_id,
            MessageSemanticSource.project_id == project_id,
            MessageSemanticSource.thread_id == thread_id,
        )
        .count()
    )

    return {
        "hasMemory": summary_count > 0,
        "summaryCount": int(summary_count),
        "lastSummaryText": getattr(last, "summary_text", None) if last else None,
        "archivedUntilMessageId": getattr(last, "to_message_id", None) if last else None,
        "archivedUntilSeqInThread": int(last.to_seq_in_thread) if last and last.to_seq_in_thread is not None else None,
        "indexedMessageCount": int(indexed),
    }


def _vec_to_pg(vec: list[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in vec) + "]"


def _has_searchable_memory_chunks(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
) -> bool:
    stmt = sql_text(
        """
        SELECT 1
        FROM message_semantic_chunks c
        JOIN message_semantic_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.thread_id = :thread_id
          AND s.language = :language
          AND s.index_state = 'ready'
        LIMIT 1
        """
    )
    row = db.execute(
        stmt,
        {
            "user_id": user_id,
            "project_id": project_id,
            "thread_id": thread_id,
            "language": language,
        },
    ).first()
    return row is not None


async def search_thread_memory(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
    queries: list[str],
    top_k_per_query: int = 20,
) -> list[dict[str, Any]]:
    if not queries:
        return []

    profile = get_embedding_profile(db, user_id=user_id, feature="memory")
    if not profile:
        return []

    if not _has_searchable_memory_chunks(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
    ):
        return []

    memory_settings = settings_service.get_memory_settings(db, user_id)
    top_k_per_query = memory_settings.retrieval.top_k_per_query
    neighbor_window = memory_settings.retrieval.neighbor_window
    max_primary_items = memory_settings.retrieval.max_primary_items
    max_total_items = memory_settings.retrieval.max_total_items

    provider_config: dict[str, Any] = credential_service.get_provider_config(
        db,
        user_id,
        str(profile["provider"]),
    )

    query_vectors = await embed_many(
        provider=profile["provider"],
        model=profile["model"],
        inputs=queries,
        config=provider_config,
        dimensions=profile.get("dimensions"),
        purpose="query",
    )

    best_by_message: dict[UUID, dict[str, Any]] = {}
    stmt = sql_text(
        """
        SELECT
          s.message_id AS message_id,
          c.chunk_index AS chunk_index,
          c.field_path AS field_path,
          c.text AS text,
          (c.embedding <-> (:qv)::vector) AS distance
        FROM message_semantic_chunks c
        JOIN message_semantic_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.thread_id = :thread_id
          AND s.language = :language
          AND s.index_state = 'ready'
        ORDER BY c.embedding <-> (:qv)::vector
        LIMIT :k
        """
    )

    for query_vec in query_vectors:
        rows = db.execute(
            stmt,
            {
                "qv": _vec_to_pg(query_vec),
                "user_id": user_id,
                "project_id": project_id,
                "thread_id": thread_id,
                "language": language,
                "k": int(top_k_per_query),
            },
        ).fetchall()
        for row in rows:
            message_id = row.message_id
            previous = best_by_message.get(message_id)
            if previous is None or (
                row.distance is not None and row.distance < (previous.get("distance") or 1e18)
            ):
                best_by_message[message_id] = {
                    "message_id": message_id,
                    "distance": float(row.distance) if row.distance is not None else None,
                    "chunk_index": int(row.chunk_index) if row.chunk_index is not None else None,
                    "field_path": str(row.field_path) if row.field_path is not None else None,
                    "content": str(row.text) if row.text is not None else "",
                }

    if not best_by_message:
        return []

    msg_rows = (
        db.query(RunMessageModel)
        .filter(
            RunMessageModel.thread_id == thread_id,
            RunMessageModel.id.in_(list(best_by_message.keys())),
        )
        .all()
    )
    by_row_id = {row.id: row for row in msg_rows}

    primary_results: list[dict[str, Any]] = []
    for message_id, info in best_by_message.items():
        row = by_row_id.get(message_id)
        if row is None:
            continue
        primary_results.append(
            {
                "message_id": row.id,
                "role": row.role,
                "content": info.get("content") or "",
                "created_at": row.created_at,
                "seq_in_thread": int(row.seq_in_thread),
                "distance": info.get("distance"),
                "field_path": info.get("field_path"),
                "chunk_index": info.get("chunk_index"),
            }
        )

    primary_results.sort(
        key=lambda item: (
            item["distance"] is None,
            item["distance"] if item["distance"] is not None else 0.0,
            item["seq_in_thread"],
        )
    )
    primary_results = primary_results[:max(1, int(max_primary_items))]

    by_message_id: dict[UUID, dict[str, Any]] = {
        item["message_id"]: item
        for item in primary_results
    }

    if neighbor_window > 0 and primary_results:
        target_sequences: set[int] = set()
        for item in primary_results:
            seq = int(item["seq_in_thread"])
            for candidate in range(seq - neighbor_window, seq + neighbor_window + 1):
                if candidate >= 0:
                    target_sequences.add(candidate)

        neighbor_rows = (
            db.query(RunMessageModel)
            .filter(
                RunMessageModel.thread_id == thread_id,
                RunMessageModel.seq_in_thread.in_(list(target_sequences)),
            )
            .all()
        )
        for row in neighbor_rows:
            if row.id in by_message_id:
                continue
            by_message_id[row.id] = {
                "message_id": row.id,
                "role": row.role,
                "content": "",
                "created_at": row.created_at,
                "seq_in_thread": int(row.seq_in_thread),
                "distance": None,
                "field_path": None,
                "chunk_index": None,
            }

    ordered = list(by_message_id.values())
    ordered.sort(
        key=lambda item: (
            item["distance"] is None,
            item["distance"] if item["distance"] is not None else 0.0,
            item["seq_in_thread"],
        )
    )
    ordered = ordered[:max(1, int(max_total_items))]
    ordered.sort(key=lambda item: item["seq_in_thread"])
    return ordered

from __future__ import annotations

from typing import Any, Dict, List
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from ..models.rag_models import RagSource
from .rag_embedding_service import embed_many
from .rag_index_service import TYPE_GROUP_ORDER, get_active_profile, get_main_language


def _vec_to_pg(vec: List[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in vec) + "]"


def _nulls_last_int(v: Any) -> tuple[int, int]:
    if v is None:
        return (1, 0)
    try:
        return (0, int(v))
    except Exception:
        return (1, 0)


async def search_project(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    queries: List[str],
    provider_config: Dict[str, Any],
    top_k_per_query: int = 20,
    neighbor_window: int = 0,
) -> List[Dict[str, Any]]:
    profile = get_active_profile(db, user_id=user_id)
    if not profile:
        raise ValueError("RAG embedding profile is not configured")

    language = get_main_language(db, user_id=user_id)

    query_vectors = await embed_many(
        provider=profile.provider,
        model=profile.model,
        inputs=queries,
        config=provider_config,
    )

    best: Dict[UUID, Dict[str, Any]] = {}

    stmt = sql_text(
        """
        SELECT
          c.id AS chunk_id,
          c.source_id AS source_id,
          c.chunk_index AS chunk_index,
          c.field_path AS field_path,
          c.text AS text,
          s.object_type AS object_type,
          s.object_id AS object_id,
          s.type_group AS type_group,
          s.story_object_type AS story_object_type,
          s.story_object_order AS story_object_order,
          s.outline_order AS outline_order,
          s.act_order AS act_order,
          s.chapter_order AS chapter_order,
          s.chapter_id AS chapter_id,
          (c.embedding <-> (:qv)::vector) AS distance
        FROM rag_chunks c
        JOIN rag_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.language = :language
          AND s.index_state = 'ready'
        ORDER BY c.embedding <-> (:qv)::vector
        LIMIT :k
        """
    )

    for qv in query_vectors:
        qv_str = _vec_to_pg(qv)
        rows = db.execute(
            stmt,
            {
                "qv": qv_str,
                "user_id": user_id,
                "project_id": project_id,
                "language": language,
                "k": int(top_k_per_query),
            },
        ).fetchall()

        for r in rows:
            chunk_id = r.chunk_id
            prev = best.get(chunk_id)
            if prev is None or (r.distance is not None and r.distance < prev.get("distance", 1e18)):
                best[chunk_id] = {
                    "chunk_id": r.chunk_id,
                    "source_id": r.source_id,
                    "chunk_index": r.chunk_index,
                    "field_path": r.field_path,
                    "text": r.text,
                    "object_type": r.object_type,
                    "object_id": r.object_id,
                    "type_group": r.type_group,
                    "story_object_type": r.story_object_type,
                    "story_object_order": r.story_object_order,
                    "outline_order": r.outline_order,
                    "act_order": r.act_order,
                    "chapter_order": r.chapter_order,
                    "chapter_id": r.chapter_id,
                    "distance": float(r.distance) if r.distance is not None else None,
                }

    # Neighbor expansion (same source_id, chunk_index +/- window)
    if neighbor_window > 0 and best:
        source_to_ranges: Dict[UUID, set[int]] = {}
        for item in best.values():
            sid = item["source_id"]
            idx = int(item["chunk_index"])
            s = source_to_ranges.setdefault(sid, set())
            for j in range(idx - neighbor_window, idx + neighbor_window + 1):
                if j >= 0:
                    s.add(j)

        neighbor_stmt = sql_text(
            """
            SELECT
              c.id AS chunk_id,
              c.source_id AS source_id,
              c.chunk_index AS chunk_index,
              c.field_path AS field_path,
              c.text AS text,
              s.object_type AS object_type,
              s.object_id AS object_id,
              s.type_group AS type_group,
              s.story_object_type AS story_object_type,
              s.story_object_order AS story_object_order,
              s.outline_order AS outline_order,
              s.act_order AS act_order,
              s.chapter_order AS chapter_order,
              s.chapter_id AS chapter_id
            FROM rag_chunks c
            JOIN rag_sources s ON s.id = c.source_id
            WHERE c.source_id = :source_id
              AND c.chunk_index = ANY(:chunk_indices)
            """
        )

        for source_id, indices in source_to_ranges.items():
            if not indices:
                continue
            rows = db.execute(
                neighbor_stmt,
                {"source_id": source_id, "chunk_indices": list(indices)},
            ).fetchall()
            for r in rows:
                if r.chunk_id in best:
                    continue
                best[r.chunk_id] = {
                    "chunk_id": r.chunk_id,
                    "source_id": r.source_id,
                    "chunk_index": r.chunk_index,
                    "field_path": r.field_path,
                    "text": r.text,
                    "object_type": r.object_type,
                    "object_id": r.object_id,
                    "type_group": r.type_group,
                    "story_object_type": r.story_object_type,
                    "story_object_order": r.story_object_order,
                    "outline_order": r.outline_order,
                    "act_order": r.act_order,
                    "chapter_order": r.chapter_order,
                    "chapter_id": r.chapter_id,
                    "distance": None,
                }

    results = list(best.values())

    # Deterministic ordering (NOT by distance)
    def sort_key(r: Dict[str, Any]):
        type_group = r.get("type_group") or ""
        try:
            group_idx = TYPE_GROUP_ORDER.index(type_group)
        except ValueError:
            group_idx = len(TYPE_GROUP_ORDER)
        return (
            group_idx,
            *_nulls_last_int(r.get("outline_order")),
            *_nulls_last_int(r.get("act_order")),
            *_nulls_last_int(r.get("chapter_order")),
            *_nulls_last_int(r.get("story_object_order")),
            int(r.get("chunk_index") or 0),
        )

    results.sort(key=sort_key)
    return results


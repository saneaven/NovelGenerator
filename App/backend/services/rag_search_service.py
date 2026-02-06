from __future__ import annotations

from typing import Any, Dict, List
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from ..models.rag_models import RagSource
from .embedding_config_service import get_embedding_profile
from .rag_embedding_service import embed_many
from .rag_index_service import get_main_language


def _vec_to_pg(vec: List[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in vec) + "]"


def _escape_like_pattern(value: str, *, escape_char: str = "!") -> str:
    """Escape a string for use inside LIKE/ILIKE patterns.

    We use ESCAPE '!' in SQL to keep the pattern syntax simple and avoid
    backslash-related surprises.
    """
    if not value:
        return ""
    value = value.replace(escape_char, escape_char + escape_char)
    value = value.replace("%", escape_char + "%")
    value = value.replace("_", escape_char + "_")
    return value


def keyword_search_project(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    keyword: str,
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    kw = (keyword or "").strip()
    if not kw:
        raise ValueError("Keyword must not be empty")

    if page < 1:
        raise ValueError("page must be >= 1")
    if page_size < 1:
        raise ValueError("page_size must be >= 1")

    language = get_main_language(db, user_id=user_id)

    escaped = _escape_like_pattern(kw)
    pattern = f"%{escaped}%"

    base_params = {
        "user_id": user_id,
        "project_id": project_id,
        "language": language,
        "pattern": pattern,
    }

    count_stmt = sql_text(
        """
        SELECT COUNT(*) AS total
        FROM rag_chunks c
        JOIN rag_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.language = :language
          AND s.index_state = 'ready'
          AND c.text ILIKE :pattern ESCAPE '!'
        """
    )

    total_row = db.execute(count_stmt, base_params).first()
    total = int(total_row.total or 0) if total_row else 0

    if total <= 0:
        return {"total": 0, "results": []}

    offset = int((page - 1) * page_size)

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
          s.chapter_id AS chapter_id
        FROM rag_chunks c
        JOIN rag_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.language = :language
          AND s.index_state = 'ready'
          AND c.text ILIKE :pattern ESCAPE '!'
        ORDER BY
          CASE s.type_group
            WHEN 'story_object' THEN 0
            WHEN 'outline' THEN 1
            WHEN 'manuscript' THEN 2
            ELSE 3
          END,
          s.story_object_type ASC NULLS LAST,
          s.story_object_order ASC NULLS LAST,
          s.outline_order ASC NULLS LAST,
          s.act_order ASC NULLS FIRST,
          s.chapter_order ASC NULLS FIRST,
          s.object_type ASC,
          s.object_id ASC,
          c.chunk_index ASC,
          c.field_path ASC
        LIMIT :limit
        OFFSET :offset
        """
    )

    rows = db.execute(
        stmt,
        {**base_params, "limit": int(page_size), "offset": offset},
    ).fetchall()

    results: List[Dict[str, Any]] = []
    for r in rows:
        results.append(
            {
                "chunk_id": r.chunk_id,
                "source_id": r.source_id,
                "object_type": r.object_type,
                "object_id": r.object_id,
                "type_group": r.type_group,
                "story_object_type": r.story_object_type,
                "story_object_order": r.story_object_order,
                "outline_order": r.outline_order,
                "act_order": r.act_order,
                "chapter_order": r.chapter_order,
                "chapter_id": r.chapter_id,
                "field_path": r.field_path,
                "chunk_index": r.chunk_index,
                "text": r.text,
                "distance": None,
            }
        )

    return {"total": total, "results": results}


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
    profile = get_embedding_profile(db, user_id=user_id, feature="ragSearch")
    if not profile:
        raise ValueError("RAG embedding profile is not configured")

    language = get_main_language(db, user_id=user_id)

    query_vectors = await embed_many(
        provider=profile["provider"],
        model=profile["model"],
        inputs=queries,
        config=provider_config,
        purpose="query",
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

    def sort_key(r: Dict[str, Any]):
        dist = r.get("distance")
        dist_missing = dist is None
        dist_value = float(dist) if dist is not None else 0.0
        return (
            1 if dist_missing else 0,
            dist_value,
            str(r.get("object_type") or ""),
            r.get("object_id"),
            int(r.get("chunk_index") or 0),
            str(r.get("field_path") or ""),
        )

    results.sort(key=sort_key)
    return results

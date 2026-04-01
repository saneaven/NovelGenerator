from __future__ import annotations

import asyncio
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.semantic_models import SemanticSource
from ..models.translation_models import ObjectVersion
from .embedding_config_service import get_embedding_profile
from .semantic_embedding_service import embed_many
from .semantic_index_service import get_main_language


def _vec_to_pg(vec: List[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in vec) + "]"


def _raise_if_invalid_regex(exc: DBAPIError) -> None:
    message = str(exc.orig or exc).lower()
    if "invalid regular expression" in message or "regular expression is invalid" in message:
        raise ValueError("Invalid regex pattern") from exc


def _has_searchable_semantic_chunks(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    language: str,
    provider: str,
    model: str,
) -> bool:
    stmt = sql_text(
        """
        SELECT 1
        FROM semantic_chunks c
        JOIN semantic_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.language = :language
          AND s.indexed_provider = :provider
          AND s.indexed_model = :model
        LIMIT 1
        """
    )
    row = db.execute(
        stmt,
        {
            "user_id": user_id,
            "project_id": project_id,
            "language": language,
            "provider": provider,
            "model": model,
        },
    ).first()
    return row is not None


def search_project_by_regex(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    pattern: str,
    case_sensitive: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    regex_pattern = (pattern or "").strip()
    if not regex_pattern:
        raise ValueError("Pattern must not be empty")

    if page < 1:
        raise ValueError("page must be >= 1")
    if page_size < 1:
        raise ValueError("page_size must be >= 1")

    profile = get_embedding_profile(db, user_id=user_id, feature="search")
    if not profile:
        raise ValueError("Semantic embedding profile is not configured")

    language = get_main_language(db, user_id=user_id)
    regex_operator = "~" if case_sensitive else "~*"

    base_params = {
        "user_id": user_id,
        "project_id": project_id,
        "language": language,
        "pattern": regex_pattern,
        "provider": str(profile["provider"]),
        "model": str(profile["model"]),
    }

    count_stmt = sql_text(
        f"""
        SELECT COUNT(*) AS total
        FROM semantic_chunks c
        JOIN semantic_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.language = :language
          AND s.indexed_provider = :provider
          AND s.indexed_model = :model
          AND c.text {regex_operator} :pattern
        """
    )

    try:
        total_row = db.execute(count_stmt, base_params).first()
    except DBAPIError as exc:
        _raise_if_invalid_regex(exc)
        raise
    total = int(total_row.total or 0) if total_row else 0

    if total <= 0:
        return {"total": 0, "results": []}

    offset = int((page - 1) * page_size)

    stmt = sql_text(
        f"""
        SELECT
          c.id AS chunk_id,
          c.source_id AS source_id,
          c.chunk_index AS chunk_index,
          c.field_path AS field_path,
          c.text AS text,
          s.object_type AS object_type,
          s.object_id AS object_id,
          s.type_group AS type_group,
          s.story_entity_kind AS story_entity_kind,
          s.story_entity_order AS story_entity_order,
          s.outline_order AS outline_order,
          s.act_order AS act_order,
          s.chapter_order AS chapter_order,
          s.chapter_id AS chapter_id
        FROM semantic_chunks c
        JOIN semantic_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.language = :language
          AND s.indexed_provider = :provider
          AND s.indexed_model = :model
          AND c.text {regex_operator} :pattern
        ORDER BY
          CASE s.type_group
            WHEN 'story_entity' THEN 0
            WHEN 'outline' THEN 1
            WHEN 'manuscript' THEN 2
            ELSE 3
          END,
          s.story_entity_kind ASC NULLS LAST,
          s.story_entity_order ASC NULLS LAST,
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

    try:
        rows = db.execute(
            stmt,
            {**base_params, "limit": int(page_size), "offset": offset},
        ).fetchall()
    except DBAPIError as exc:
        _raise_if_invalid_regex(exc)
        raise

    results: List[Dict[str, Any]] = []
    for r in rows:
        results.append(
            {
                "chunk_id": str(r.chunk_id),
                "source_id": str(r.source_id),
                "object_type": r.object_type,
                "object_id": str(r.object_id),
                "type_group": r.type_group,
                "story_entity_kind": r.story_entity_kind,
                "story_entity_order": r.story_entity_order,
                "outline_order": r.outline_order,
                "act_order": r.act_order,
                "chapter_order": r.chapter_order,
                "chapter_id": str(r.chapter_id) if r.chapter_id else None,
                "field_path": r.field_path,
                "chunk_index": r.chunk_index,
                "text": r.text,
                "distance": None,
            }
        )

    return {"total": total, "results": results}


def _row_to_chunk_dict(r, *, distance: float | None) -> Dict[str, Any]:
    return {
        "chunk_id": str(r.chunk_id),
        "source_id": str(r.source_id),
        "chunk_index": r.chunk_index,
        "field_path": r.field_path,
        "text": r.text,
        "object_type": r.object_type,
        "object_id": str(r.object_id),
        "type_group": r.type_group,
        "story_entity_kind": r.story_entity_kind,
        "story_entity_order": r.story_entity_order,
        "outline_order": r.outline_order,
        "act_order": r.act_order,
        "chapter_order": r.chapter_order,
        "chapter_id": str(r.chapter_id) if r.chapter_id else None,
        "distance": float(distance) if distance is not None else None,
    }


def _sort_key(r: Dict[str, Any]):
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


def _run_vector_queries(
    *,
    query_vectors: List[List[float]],
    user_id: UUID,
    project_id: UUID,
    language: str,
    provider: str,
    model: str,
    top_k_per_query: int,
    neighbor_window: int,
    max_primary_items: int,
    max_total_items: int,
) -> List[Dict[str, Any]]:
    """Run vector similarity queries in a worker thread with a dedicated DB session.

    This avoids blocking the asyncio event loop with potentially slow
    full-table-scan vector distance calculations.
    """
    db_thread = SessionLocal()
    try:
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
              s.story_entity_kind AS story_entity_kind,
              s.story_entity_order AS story_entity_order,
              s.outline_order AS outline_order,
              s.act_order AS act_order,
              s.chapter_order AS chapter_order,
              s.chapter_id AS chapter_id,
              (c.embedding <-> (:qv)::vector) AS distance
            FROM semantic_chunks c
            JOIN semantic_sources s ON s.id = c.source_id
            WHERE s.user_id = :user_id
              AND s.project_id = :project_id
              AND s.language = :language
              AND s.indexed_provider = :provider
              AND s.indexed_model = :model
            ORDER BY c.embedding <-> (:qv)::vector
            LIMIT :k
            """
        )

        for qv in query_vectors:
            qv_str = _vec_to_pg(qv)
            try:
                rows = db_thread.execute(
                    stmt,
                    {
                        "qv": qv_str,
                        "user_id": user_id,
                        "project_id": project_id,
                        "language": language,
                        "provider": provider,
                        "model": model,
                        "k": int(top_k_per_query),
                    },
                ).fetchall()
            except Exception as exc:
                db_thread.rollback()
                msg = str(exc)
                if "different vector dimensions" in msg or "expected" in msg.lower() and "dimension" in msg.lower():
                    raise ValueError(
                        "Vector dimension mismatch — the embedding model may have changed. "
                        "Please run a full reindex (force=true) to fix this."
                    ) from exc
                raise

            for r in rows:
                chunk_id = r.chunk_id
                prev = best.get(chunk_id)
                if prev is None or (r.distance is not None and r.distance < prev.get("distance", 1e18)):
                    best[chunk_id] = _row_to_chunk_dict(r, distance=r.distance)

        primary_items = list(best.values())
        primary_items.sort(key=_sort_key)
        primary_items = primary_items[: max(1, int(max_primary_items))]
        selected: Dict[str, Dict[str, Any]] = {
            str(item["chunk_id"]): item
            for item in primary_items
        }

        # Neighbor expansion (same source_id, chunk_index +/- window)
        if neighbor_window > 0 and primary_items:
            source_to_ranges: Dict[UUID, set[int]] = {}
            for item in primary_items:
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
                  s.story_entity_kind AS story_entity_kind,
                  s.story_entity_order AS story_entity_order,
                  s.outline_order AS outline_order,
                  s.act_order AS act_order,
                  s.chapter_order AS chapter_order,
                  s.chapter_id AS chapter_id
                FROM semantic_chunks c
                JOIN semantic_sources s ON s.id = c.source_id
                WHERE c.source_id = :source_id
                  AND c.chunk_index = ANY(:chunk_indices)
                """
            )

            for source_id, indices in source_to_ranges.items():
                if not indices:
                    continue
                rows = db_thread.execute(
                    neighbor_stmt,
                    {"source_id": source_id, "chunk_indices": list(indices)},
                ).fetchall()
                for r in rows:
                    if str(r.chunk_id) in selected:
                        continue
                    selected[str(r.chunk_id)] = _row_to_chunk_dict(r, distance=None)

        results = list(selected.values())
        results.sort(key=_sort_key)
        results = results[: max(1, int(max_total_items))]
        return results
    finally:
        db_thread.close()


async def search_project(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    queries: List[str],
    provider_config: Dict[str, Any],
    top_k_per_query: int = 20,
    neighbor_window: int = 0,
    max_primary_items: int = 20,
    max_total_items: int = 60,
) -> List[Dict[str, Any]]:
    profile = get_embedding_profile(db, user_id=user_id, feature="search")
    if not profile:
        raise ValueError("Semantic embedding profile is not configured")

    language = get_main_language(db, user_id=user_id)
    provider = str(profile["provider"])
    model = str(profile["model"])

    if not _has_searchable_semantic_chunks(
        db,
        user_id=user_id,
        project_id=project_id,
        language=language,
        provider=provider,
        model=model,
    ):
        return []

    query_vectors = await embed_many(
        provider=provider,
        model=model,
        inputs=queries,
        config=provider_config,
        purpose="query",
    )

    results = await asyncio.to_thread(
        _run_vector_queries,
        query_vectors=query_vectors,
        user_id=user_id,
        project_id=project_id,
        language=language,
        provider=provider,
        model=model,
        top_k_per_query=top_k_per_query,
        neighbor_window=neighbor_window,
        max_primary_items=max_primary_items,
        max_total_items=max_total_items,
    )
    return results


# ── Search payload builder (backend → frontend contract) ──


def _batch_resolve_display_names(
    db: Session,
    *,
    object_refs: Set[Tuple[str, str]],
    language: str,
) -> Dict[Tuple[str, str], str]:
    """Resolve display names for a set of (object_type, object_id) pairs."""
    if not object_refs:
        return {}

    # Validate UUIDs and build filter conditions
    valid_refs: List[Tuple[str, UUID]] = []
    for object_type, object_id_str in object_refs:
        try:
            valid_refs.append((object_type, UUID(object_id_str)))
        except (ValueError, AttributeError):
            continue

    if not valid_refs:
        return {}

    # Single query: fetch latest version per (object_type, object_id) using OR conditions
    from sqlalchemy import or_, and_, tuple_

    conditions = or_(
        *[
            and_(ObjectVersion.object_type == ot, ObjectVersion.object_id == oid)
            for ot, oid in valid_refs
        ]
    )

    from sqlalchemy import func

    latest_subq = (
        db.query(
            ObjectVersion.object_type,
            ObjectVersion.object_id,
            func.max(ObjectVersion.version_number).label("max_ver"),
        )
        .filter(conditions)
        .group_by(ObjectVersion.object_type, ObjectVersion.object_id)
        .subquery()
    )

    rows = (
        db.query(ObjectVersion)
        .join(
            latest_subq,
            and_(
                ObjectVersion.object_type == latest_subq.c.object_type,
                ObjectVersion.object_id == latest_subq.c.object_id,
                ObjectVersion.version_number == latest_subq.c.max_ver,
            ),
        )
        .all()
    )

    result_map: Dict[Tuple[str, str], str] = {}
    for row in rows:
        data = row.data if isinstance(row.data, dict) else {}
        lang_data = data.get(language)
        if not isinstance(lang_data, dict):
            for v in data.values():
                if isinstance(v, dict):
                    lang_data = v
                    break
            else:
                continue

        key = (row.object_type, str(row.object_id))
        name = lang_data.get("name") or lang_data.get("title")
        if isinstance(name, str) and name.strip():
            result_map[key] = name.strip()

    return result_map


def build_search_payload(
    db: Session,
    *,
    search_type: str,
    results: List[Dict[str, Any]],
    language: str,
    pattern: Optional[str] = None,
    case_sensitive: Optional[bool] = None,
    queries: Optional[List[str]] = None,
    page: Optional[int] = None,
    page_size: Optional[int] = None,
    total: Optional[int] = None,
) -> Dict[str, Any]:
    """Transform flat search results into the grouped searchPayload format."""
    # Collect unique (object_type, object_id) pairs
    object_refs: Set[Tuple[str, str]] = set()
    for r in results:
        ot = str(r.get("object_type") or "")
        oid = str(r.get("object_id") or "")
        if ot and oid:
            object_refs.add((ot, oid))

    name_map = _batch_resolve_display_names(db, object_refs=object_refs, language=language)

    # Group results by (object_type, object_id), preserving order
    groups_dict: OrderedDict[Tuple[str, str], List[Dict[str, Any]]] = OrderedDict()
    for r in results:
        ot = str(r.get("object_type") or "")
        oid = str(r.get("object_id") or "")
        key = (ot, oid)
        if key not in groups_dict:
            groups_dict[key] = []
        groups_dict[key].append(r)

    groups: List[Dict[str, Any]] = []
    for (ot, oid), entries in groups_dict.items():
        display_name = name_map.get((ot, oid), oid)
        groups.append({
            "objectType": ot,
            "objectId": oid,
            "displayName": display_name,
            "entries": [
                {
                    "text": str(e.get("text") or ""),
                    "fieldPath": e.get("field_path"),
                    "chunkIndex": e.get("chunk_index"),
                    "distance": e.get("distance"),
                }
                for e in entries
            ],
        })

    payload: Dict[str, Any] = {
        "type": search_type,
        "groups": groups,
    }
    if pattern is not None:
        payload["pattern"] = pattern
    if case_sensitive is not None:
        payload["caseSensitive"] = case_sensitive
    if queries is not None:
        payload["queries"] = queries
    if page is not None:
        payload["page"] = page
    if page_size is not None:
        payload["pageSize"] = page_size
    if total is not None:
        payload["total"] = total

    return payload

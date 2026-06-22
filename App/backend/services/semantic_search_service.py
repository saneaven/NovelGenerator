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
from ..models.translation_models import ObjectVersion, ObjectVersionLanguage
from .embedding_config_service import get_embedding_profile
from .semantic_embedding_service import embed_many
from .semantic_index_service import get_main_language


SEARCH_FILTER_GROUP_OBJECT_TYPES: Dict[str, Tuple[str, ...]] = {
    "story_entity": ("story_entity",),
    "outline": ("outline",),
    "manuscript": ("manuscript",),
    "timeline": ("timeline_track", "timeline_event"),
}


def _vec_to_pg(vec: List[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in vec) + "]"


def _raise_if_invalid_regex(exc: DBAPIError) -> None:
    message = str(exc.orig or exc).lower()
    if "invalid regular expression" in message or "regular expression is invalid" in message:
        raise ValueError("Invalid regex pattern") from exc


def _normalize_search_filter(search_filter: Any | None) -> Dict[str, Any] | None:
    if search_filter is None:
        return None

    if isinstance(search_filter, dict):
        unknown = set(search_filter.keys()) - {"groups", "objectIds"}
        if unknown:
            raise ValueError(f"Unknown search filter fields: {', '.join(sorted(unknown))}")
        raw_groups = search_filter.get("groups") or []
        raw_object_ids = search_filter.get("objectIds") or []
    else:
        raw_groups = getattr(search_filter, "groups", [])
        raw_object_ids = getattr(search_filter, "object_ids", [])

    if not isinstance(raw_groups, list):
        raise ValueError("search filter groups must be an array")
    if not isinstance(raw_object_ids, list):
        raise ValueError("search filter objectIds must be an array")

    groups: List[str] = []
    object_types: List[str] = []
    for raw_group in raw_groups:
        group = str(raw_group or "").strip()
        mapped_types = SEARCH_FILTER_GROUP_OBJECT_TYPES.get(group)
        if mapped_types is None:
            raise ValueError(f"Invalid search filter group: {raw_group}")
        if group not in groups:
            groups.append(group)
        for object_type in mapped_types:
            if object_type not in object_types:
                object_types.append(object_type)

    object_ids: List[UUID] = []
    for raw_object_id in raw_object_ids:
        try:
            object_id = raw_object_id if isinstance(raw_object_id, UUID) else UUID(str(raw_object_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValueError(f"Invalid search filter object id: {raw_object_id}") from exc
        if object_id not in object_ids:
            object_ids.append(object_id)

    if not groups and not object_ids:
        return None

    return {
        "groups": groups,
        "object_types": object_types,
        "object_ids": object_ids,
    }


def _public_search_filter(search_filter: Any | None) -> Dict[str, Any] | None:
    normalized = _normalize_search_filter(search_filter)
    if normalized is None:
        return None

    payload: Dict[str, Any] = {}
    groups = normalized.get("groups") or []
    object_ids = normalized.get("object_ids") or []
    if groups:
        payload["groups"] = list(groups)
    if object_ids:
        payload["objectIds"] = [str(object_id) for object_id in object_ids]
    return payload or None


def _search_filter_sql(search_filter: Dict[str, Any] | None) -> Tuple[str, Dict[str, Any]]:
    if search_filter is None:
        return "", {}

    conditions: List[str] = []
    params: Dict[str, Any] = {}
    object_types = list(search_filter.get("object_types") or [])
    object_ids = list(search_filter.get("object_ids") or [])

    if object_types:
        conditions.append("s.object_type = ANY(:filter_object_types)")
        params["filter_object_types"] = object_types
    if object_ids:
        conditions.append("s.object_id = ANY(:filter_object_ids)")
        params["filter_object_ids"] = object_ids

    if not conditions:
        return "", {}
    return "\n          AND (" + " OR ".join(conditions) + ")", params


def _has_searchable_semantic_chunks(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    language: str,
    provider: str,
    model: str,
    search_filter: Dict[str, Any] | None = None,
) -> bool:
    filter_clause, filter_params = _search_filter_sql(search_filter)
    stmt = sql_text(
        f"""
        SELECT 1
        FROM semantic_chunks c
        JOIN semantic_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.language = :language
          AND s.indexed_provider = :provider
          AND s.indexed_model = :model
          {filter_clause}
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
            **filter_params,
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
    search_filter: Any | None = None,
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
    normalized_filter = _normalize_search_filter(search_filter)
    filter_clause, filter_params = _search_filter_sql(normalized_filter)

    base_params = {
        "user_id": user_id,
        "project_id": project_id,
        "language": language,
        "pattern": regex_pattern,
        "provider": str(profile["provider"]),
        "model": str(profile["model"]),
        **filter_params,
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
          {filter_clause}
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
          {filter_clause}
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
    search_filter: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    """Run vector similarity queries in a worker thread with a dedicated DB session.

    This avoids blocking the asyncio event loop with potentially slow
    full-table-scan vector distance calculations.
    """
    db_thread = SessionLocal()
    try:
        best: Dict[UUID, Dict[str, Any]] = {}
        filter_clause, filter_params = _search_filter_sql(search_filter)

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
              s.chapter_id AS chapter_id,
              (c.embedding <-> (:qv)::vector) AS distance
            FROM semantic_chunks c
            JOIN semantic_sources s ON s.id = c.source_id
            WHERE s.user_id = :user_id
              AND s.project_id = :project_id
              AND s.language = :language
              AND s.indexed_provider = :provider
              AND s.indexed_model = :model
              {filter_clause}
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
                        **filter_params,
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
    search_filter: Any | None = None,
) -> List[Dict[str, Any]]:
    profile = get_embedding_profile(db, user_id=user_id, feature="search")
    if not profile:
        raise ValueError("Semantic embedding profile is not configured")

    language = get_main_language(db, user_id=user_id)
    provider = str(profile["provider"])
    model = str(profile["model"])
    normalized_filter = _normalize_search_filter(search_filter)

    if not _has_searchable_semantic_chunks(
        db,
        user_id=user_id,
        project_id=project_id,
        language=language,
        provider=provider,
        model=model,
        search_filter=normalized_filter,
    ):
        return []

    query_vectors = await embed_many(
        provider=provider,
        model=model,
        inputs=queries,
        config=provider_config,
        dimensions=profile.get("dimensions"),
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
        search_filter=normalized_filter,
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
    from sqlalchemy import or_, and_

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
        db.query(ObjectVersion, ObjectVersionLanguage)
        .join(
            latest_subq,
            and_(
                ObjectVersion.object_type == latest_subq.c.object_type,
                ObjectVersion.object_id == latest_subq.c.object_id,
                ObjectVersion.version_number == latest_subq.c.max_ver,
            ),
        )
        .join(
            ObjectVersionLanguage,
            and_(
                ObjectVersionLanguage.version_id == ObjectVersion.id,
                ObjectVersionLanguage.language == language,
            ),
        )
        .all()
    )

    result_map: Dict[Tuple[str, str], str] = {}
    for version, lang_row in rows:
        lang_data = lang_row.data if isinstance(lang_row.data, dict) else {}
        key = (version.object_type, str(version.object_id))
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
    search_filter: Any | None = None,
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
    filter_payload = _public_search_filter(search_filter)
    if filter_payload is not None:
        payload["filter"] = filter_payload

    return payload

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..models.db_models import (
    Manuscript,
    Outline,
    StoryEntity,
    UserSettings,
)
from ..models.semantic_models import SemanticChunk, SemanticSource
from ..models.translation_models import ObjectVersion
from ..utils.story_entities import STORY_ENTITY_TYPE
from .embedding_config_service import get_embedding_profile, set_embedding_dimensions
from .semantic_chunker import merge_blocks_by_length, split_markdown_blocks, split_plaintext_blocks
from .semantic_embedding_service import embed_many
from .semantic_text_extractors import extract_index_text


STORY_ENTITY_CONTEXT_TYPES = {"basic_info", "guidelines", STORY_ENTITY_TYPE}
EXCLUDED_OBJECT_TYPES = {"basic_info", "guidelines"}

MIN_CHARS = 200
TARGET_CHARS = 600
MAX_CHARS = 1200

_WS_RE = re.compile(r"[ \t]+")
_MULTI_NL_RE = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class OrderMeta:
    type_group: str
    story_entity_kind: Optional[str] = None
    story_entity_order: Optional[int] = None
    outline_order: Optional[int] = None
    act_order: Optional[int] = None
    chapter_order: Optional[int] = None
    chapter_id: Optional[UUID] = None


@dataclass(frozen=True)
class CurrentPayload:
    has_indexable_text: bool
    chunks: List[Dict[str, Any]]
    embedding_texts: List[str]
    current_hash: Optional[str]


@dataclass(frozen=True)
class PreparedIndexJob:
    user_id: UUID
    project_id: UUID
    object_type: str
    object_id: UUID
    language: str
    order_meta: OrderMeta
    new_hash: str
    chunks: List[Dict[str, Any]]
    embedding_texts: List[str]
    provider: str
    model: str
    stored_dimensions: int | None


def wipe_user_semantic_index(db: Session, *, user_id: UUID) -> None:
    db.query(SemanticSource).filter(SemanticSource.user_id == user_id).delete(synchronize_session=False)


def get_main_language(db: Session, *, user_id: UUID) -> str:
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    return settings.main_language if settings else "English"


def normalize_for_hash(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join([line.rstrip() for line in text.split("\n")])
    text = _WS_RE.sub(" ", text)
    text = _MULTI_NL_RE.sub("\n\n", text)
    return text.strip()


def compute_chunks_hash(chunks: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for chunk in chunks:
        field_path = chunk.get("field_path")
        chunk_index = chunk.get("chunk_index")
        text = chunk.get("text")
        if not isinstance(field_path, str) or not isinstance(chunk_index, int) or not isinstance(text, str):
            continue
        normalized = normalize_for_hash(text)
        if not normalized:
            continue
        parts.append(f"[{field_path}:{chunk_index}]\n{normalized}\n")
    return sha256("\n".join(parts).encode("utf-8")).hexdigest()


def chunk_fields(text_by_field: Dict[str, str]) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    chunk_index = 0

    for field_path in ["description", "content", "doc"]:
        raw = (text_by_field.get(field_path) or "").strip()
        if not raw:
            continue

        blocks = split_plaintext_blocks(raw) if field_path == "doc" else split_markdown_blocks(raw)
        merged = merge_blocks_by_length(
            blocks,
            min_chars=MIN_CHARS,
            target_chars=TARGET_CHARS,
            max_chars=MAX_CHARS,
        )

        for text in merged:
            chunks.append({"field_path": field_path, "chunk_index": chunk_index, "text": text})
            chunk_index += 1

    return chunks


def _build_embedding_payloads(
    *,
    object_type: str,
    text_by_field: Dict[str, str],
) -> tuple[List[Dict[str, Any]], List[str], str]:
    chunks = chunk_fields(text_by_field)
    if not chunks:
        return [], [], compute_chunks_hash([])

    name_prefix: Optional[str] = None
    if object_type in STORY_ENTITY_CONTEXT_TYPES and object_type not in EXCLUDED_OBJECT_TYPES:
        name_prefix = (text_by_field.get("name") or "").strip() or None

    embedding_texts: List[str] = []
    hash_chunks: List[Dict[str, Any]] = []
    for chunk in chunks:
        embed_text = chunk["text"]
        if name_prefix and chunk["field_path"] in ("content", "description"):
            embed_text = f"{name_prefix}\n\n{embed_text}"
        embedding_texts.append(embed_text)
        hash_chunks.append(
            {
                "field_path": chunk["field_path"],
                "chunk_index": chunk["chunk_index"],
                "text": embed_text,
            }
        )

    return chunks, embedding_texts, compute_chunks_hash(hash_chunks)


def _latest_version(db: Session, *, object_type: str, object_id: UUID) -> Optional[ObjectVersion]:
    return (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )


def _latest_versions_for_refs(
    db: Session,
    *,
    refs: Sequence[Tuple[str, UUID]],
) -> Dict[Tuple[str, UUID], ObjectVersion]:
    by_type: Dict[str, List[UUID]] = {}
    for object_type, object_id in refs:
        by_type.setdefault(object_type, []).append(object_id)

    latest_versions: Dict[Tuple[str, UUID], ObjectVersion] = {}
    for object_type, object_ids in by_type.items():
        if not object_ids:
            continue
        subq = (
            db.query(
                ObjectVersion.object_id.label("object_id"),
                func.max(ObjectVersion.version_number).label("max_version"),
            )
            .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id.in_(object_ids))
            .group_by(ObjectVersion.object_id)
            .subquery()
        )

        rows = (
            db.query(ObjectVersion)
            .join(
                subq,
                and_(
                    ObjectVersion.object_id == subq.c.object_id,
                    ObjectVersion.version_number == subq.c.max_version,
                ),
            )
            .filter(ObjectVersion.object_type == object_type)
            .all()
        )
        for row in rows:
            latest_versions[(object_type, row.object_id)] = row

    return latest_versions


def compute_order_meta(db: Session, *, project_id: UUID, object_type: str, object_id: UUID) -> OrderMeta:
    if object_type in STORY_ENTITY_CONTEXT_TYPES:
        story_entity_order: Optional[int] = 0
        story_entity_kind: Optional[str] = object_type
        if object_type == STORY_ENTITY_TYPE:
            row = (
                db.query(StoryEntity)
                .filter(StoryEntity.id == object_id, StoryEntity.project_id == project_id)
                .first()
            )
            story_entity_order = (row.display_order if row else 0) or 0
            story_entity_kind = row.kind if row is not None else None

        return OrderMeta(
            type_group="story_entity",
            story_entity_kind=story_entity_kind,
            story_entity_order=story_entity_order,
        )

    if object_type == "outline":
        outline = db.query(Outline).filter(Outline.id == object_id, Outline.project_id == project_id).first()
        if not outline:
            return OrderMeta(type_group="outline")

        root = outline if outline.kind == "outline" else outline.parent
        act = None
        chapter = None
        if outline.kind == "act":
            act = outline
        elif outline.kind == "chapter":
            chapter = outline
            act = outline.parent
        elif outline.kind == "outline":
            root = outline

        return OrderMeta(
            type_group="outline",
            outline_order=int(root.position if root else 0),
            act_order=int(act.position if act else 0) if act else None,
            chapter_order=int(chapter.position if chapter else 0) if chapter else None,
            chapter_id=chapter.id if chapter is not None else None,
        )

    if object_type == "manuscript":
        manuscript = (
            db.query(Manuscript)
            .join(Outline, Outline.id == Manuscript.chapter_id)
            .filter(Manuscript.id == object_id, Outline.project_id == project_id, Outline.kind == "chapter")
            .first()
        )
        if not manuscript or not manuscript.chapter:
            return OrderMeta(type_group="manuscript")
        chapter = manuscript.chapter
        act = chapter.parent
        root = act.parent if act is not None else None
        return OrderMeta(
            type_group="manuscript",
            outline_order=int(root.position if root else 0),
            act_order=int(act.position if act else 0) if act else None,
            chapter_order=int(chapter.position if chapter else 0),
            chapter_id=manuscript.chapter_id,
        )

    return OrderMeta(type_group="story_entity", story_entity_kind=object_type, story_entity_order=0)


def _build_current_payload(
    *,
    object_type: str,
    latest: Optional[ObjectVersion],
    language: str,
) -> CurrentPayload:
    if latest is None or not isinstance(latest.data, dict):
        return CurrentPayload(has_indexable_text=False, chunks=[], embedding_texts=[], current_hash=None)

    text_by_field = extract_index_text(object_type, latest.data, language)
    if not text_by_field:
        return CurrentPayload(has_indexable_text=False, chunks=[], embedding_texts=[], current_hash=None)
    if not any((value or "").strip() for value in text_by_field.values()):
        return CurrentPayload(has_indexable_text=False, chunks=[], embedding_texts=[], current_hash=None)

    chunks, embedding_texts, current_hash = _build_embedding_payloads(
        object_type=object_type,
        text_by_field=text_by_field,
    )
    if not chunks:
        return CurrentPayload(has_indexable_text=False, chunks=[], embedding_texts=[], current_hash=None)

    return CurrentPayload(
        has_indexable_text=True,
        chunks=chunks,
        embedding_texts=embedding_texts,
        current_hash=current_hash,
    )


def _find_source(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
) -> Optional[SemanticSource]:
    return (
        db.query(SemanticSource)
        .filter(
            SemanticSource.user_id == user_id,
            SemanticSource.project_id == project_id,
            SemanticSource.object_type == object_type,
            SemanticSource.object_id == object_id,
            SemanticSource.language == language,
        )
        .first()
    )


def _delete_source_rows(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
) -> int:
    deleted = (
        db.query(SemanticSource)
        .filter(
            SemanticSource.user_id == user_id,
            SemanticSource.project_id == project_id,
            SemanticSource.object_type == object_type,
            SemanticSource.object_id == object_id,
            SemanticSource.language == language,
        )
        .delete(synchronize_session=False)
    )
    return int(deleted or 0)


def invalidate_object_index(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> int:
    language = get_main_language(db, user_id=user_id)
    return _delete_source_rows(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        language=language,
    )


def _source_has_chunks(db: Session, *, source_id: UUID) -> bool:
    row = db.query(SemanticChunk.source_id).filter(SemanticChunk.source_id == source_id).first()
    return row is not None


def _clear_source_index_payload(source: SemanticSource) -> None:
    source.content_hash = None
    source.indexed_provider = None
    source.indexed_model = None
    source.indexed_at = None


def _upsert_source(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
    order_meta: OrderMeta,
) -> SemanticSource:
    source = _find_source(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        language=language,
    )
    if not source:
        source = SemanticSource(
            user_id=user_id,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            language=language,
            type_group=order_meta.type_group,
            story_entity_kind=order_meta.story_entity_kind,
            story_entity_order=order_meta.story_entity_order,
            outline_order=order_meta.outline_order,
            act_order=order_meta.act_order,
            chapter_order=order_meta.chapter_order,
            chapter_id=order_meta.chapter_id,
        )
        db.add(source)
        db.flush()

    source.type_group = order_meta.type_group
    source.story_entity_kind = order_meta.story_entity_kind
    source.story_entity_order = order_meta.story_entity_order
    source.outline_order = order_meta.outline_order
    source.act_order = order_meta.act_order
    source.chapter_order = order_meta.chapter_order
    source.chapter_id = order_meta.chapter_id

    return source


def delete_object_index(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> int:
    deleted = invalidate_object_index(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
    )
    db.commit()
    return deleted


def _source_matches_current_index(
    source: SemanticSource,
    *,
    current_hash: Optional[str],
    provider: str,
    model: str,
) -> bool:
    if not current_hash:
        return False
    return (
        source.content_hash == current_hash
        and source.indexed_provider == provider
        and source.indexed_model == model
    )


def _record_index_error(
    db: Session,
    *,
    prepared: PreparedIndexJob,
    message: str,
    current_hash: Optional[str],
    preserve_searchable: bool,
) -> None:
    source = _find_source(
        db,
        user_id=prepared.user_id,
        project_id=prepared.project_id,
        object_type=prepared.object_type,
        object_id=prepared.object_id,
        language=prepared.language,
    )

    should_preserve = False
    if source and preserve_searchable and _source_has_chunks(db, source_id=source.id):
        should_preserve = _source_matches_current_index(
            source,
            current_hash=current_hash,
            provider=prepared.provider,
            model=prepared.model,
        )

    if not should_preserve:
        source = _upsert_source(
            db,
            user_id=prepared.user_id,
            project_id=prepared.project_id,
            object_type=prepared.object_type,
            object_id=prepared.object_id,
            language=prepared.language,
            order_meta=prepared.order_meta,
        )
        db.query(SemanticChunk).filter(SemanticChunk.source_id == source.id).delete(synchronize_session=False)
        _clear_source_index_payload(source)

    if source is None:
        db.commit()
        return

    source.last_attempted_hash = current_hash
    source.last_attempted_provider = prepared.provider
    source.last_attempted_model = prepared.model
    source.last_error_at = datetime.utcnow()
    source.last_error_message = message
    db.commit()


def _prepare_index_job(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    force: bool,
) -> tuple[PreparedIndexJob | None, Dict[str, Any] | None]:
    if object_type in EXCLUDED_OBJECT_TYPES:
        return None, {"rebuilt": False, "skipped": True, "missing_main_language": False}

    profile = get_embedding_profile(db, user_id=user_id, feature="search")
    if not profile:
        raise ValueError("Semantic embedding profile is not configured")

    language = get_main_language(db, user_id=user_id)
    latest = _latest_version(db, object_type=object_type, object_id=object_id)
    payload = _build_current_payload(object_type=object_type, latest=latest, language=language)

    if not payload.has_indexable_text:
        _delete_source_rows(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            language=language,
        )
        db.commit()
        return None, {"rebuilt": False, "skipped": True, "missing_main_language": True}

    existing_source = _find_source(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        language=language,
    )
    if (
        existing_source
        and not force
        and _source_has_chunks(db, source_id=existing_source.id)
        and _source_matches_current_index(
            existing_source,
            current_hash=payload.current_hash,
            provider=str(profile["provider"]),
            model=str(profile["model"]),
        )
    ):
        db.commit()
        return None, {"rebuilt": False, "skipped": True, "missing_main_language": False}

    order_meta = compute_order_meta(db, project_id=project_id, object_type=object_type, object_id=object_id)
    prepared = PreparedIndexJob(
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        language=language,
        order_meta=order_meta,
        new_hash=str(payload.current_hash),
        chunks=payload.chunks,
        embedding_texts=payload.embedding_texts,
        provider=str(profile["provider"]),
        model=str(profile["model"]),
        stored_dimensions=profile.get("dimensions"),
    )
    db.commit()
    return prepared, None


def _apply_index_vectors(
    db: Session,
    *,
    prepared: PreparedIndexJob,
    vectors: List[List[float]],
) -> Dict[str, Any]:
    current_profile = get_embedding_profile(db, user_id=prepared.user_id, feature="search")
    if not current_profile:
        db.commit()
        return {"rebuilt": False, "skipped": True, "missing_main_language": False, "stale": True}
    if current_profile.get("provider") != prepared.provider or current_profile.get("model") != prepared.model:
        db.commit()
        return {"rebuilt": False, "skipped": True, "missing_main_language": False, "stale": True}

    latest = _latest_version(db, object_type=prepared.object_type, object_id=prepared.object_id)
    payload = _build_current_payload(
        object_type=prepared.object_type,
        latest=latest,
        language=prepared.language,
    )
    if not payload.has_indexable_text or payload.current_hash != prepared.new_hash:
        db.commit()
        return {"rebuilt": False, "skipped": True, "missing_main_language": False, "stale": True}

    if not vectors:
        _record_index_error(
            db,
            prepared=prepared,
            message="Embedding provider returned no vectors",
            current_hash=payload.current_hash,
            preserve_searchable=True,
        )
        return {"rebuilt": False, "skipped": True, "missing_main_language": False}

    embedding_dim = len(vectors[0])
    if any(len(vector) != embedding_dim for vector in vectors):
        raise RuntimeError("Embedding vectors have inconsistent dimensions")

    if prepared.stored_dimensions is None:
        set_embedding_dimensions(db, user_id=prepared.user_id, feature="search", dimensions=embedding_dim)
    elif prepared.stored_dimensions != embedding_dim:
        raise RuntimeError(
            f"Embedding dimensions mismatch (profile={prepared.stored_dimensions}, got={embedding_dim})"
        )

    source = _upsert_source(
        db,
        user_id=prepared.user_id,
        project_id=prepared.project_id,
        object_type=prepared.object_type,
        object_id=prepared.object_id,
        language=prepared.language,
        order_meta=prepared.order_meta,
    )

    db.query(SemanticChunk).filter(SemanticChunk.source_id == source.id).delete(synchronize_session=False)
    for chunk, vector in zip(prepared.chunks, vectors):
        db.add(
            SemanticChunk(
                source_id=source.id,
                field_path=chunk["field_path"],
                chunk_index=chunk["chunk_index"],
                text=chunk["text"],
                embedding=vector,
                embedding_dim=embedding_dim,
            )
        )

    source.content_hash = prepared.new_hash
    source.indexed_provider = prepared.provider
    source.indexed_model = prepared.model
    source.indexed_at = datetime.utcnow()
    source.last_attempted_hash = None
    source.last_attempted_provider = None
    source.last_attempted_model = None
    source.last_error_at = None
    source.last_error_message = None
    db.commit()
    return {"rebuilt": True, "skipped": False, "missing_main_language": False}


async def index_object(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    provider_config: Dict[str, Any],
    force: bool = False,
) -> Dict[str, Any]:
    prepared, immediate_result = _prepare_index_job(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        force=force,
    )
    if immediate_result is not None:
        return immediate_result
    if prepared is None:
        return {"rebuilt": False, "skipped": True, "missing_main_language": False}

    try:
        vectors = await embed_many(
            provider=prepared.provider,
            model=prepared.model,
            inputs=prepared.embedding_texts,
            config=provider_config,
            purpose="document",
        )
        return _apply_index_vectors(db, prepared=prepared, vectors=vectors)
    except Exception as exc:
        latest = _latest_version(db, object_type=prepared.object_type, object_id=prepared.object_id)
        payload = _build_current_payload(
            object_type=prepared.object_type,
            latest=latest,
            language=prepared.language,
        )
        _record_index_error(
            db,
            prepared=prepared,
            message=str(exc),
            current_hash=payload.current_hash,
            preserve_searchable=True,
        )
        raise


def _project_object_refs(db: Session, *, project_id: UUID) -> List[Tuple[str, UUID]]:
    refs: List[Tuple[str, UUID]] = []

    for row in db.query(StoryEntity).filter(StoryEntity.project_id == project_id).order_by(StoryEntity.display_order.asc()).all():
        refs.append((STORY_ENTITY_TYPE, row.id))

    outlines = db.query(Outline).filter(Outline.project_id == project_id).order_by(Outline.position.asc()).all()
    manuscripts_by_chapter = {
        manuscript.chapter_id: manuscript
        for manuscript in db.query(Manuscript)
        .join(Outline, Outline.id == Manuscript.chapter_id)
        .filter(Outline.project_id == project_id, Outline.kind == "chapter")
        .all()
    }
    for outline in outlines:
        refs.append(("outline", outline.id))
        manuscript = manuscripts_by_chapter.get(outline.id)
        if manuscript is not None:
            refs.append(("manuscript", manuscript.id))

    return refs


def _load_project_sources(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    language: str,
) -> Dict[Tuple[str, UUID], SemanticSource]:
    rows = (
        db.query(SemanticSource)
        .filter(
            SemanticSource.user_id == user_id,
            SemanticSource.project_id == project_id,
            SemanticSource.language == language,
        )
        .all()
    )
    return {(row.object_type, row.object_id): row for row in rows}


def _load_chunked_source_ids(db: Session, *, source_ids: Sequence[UUID]) -> set[UUID]:
    if not source_ids:
        return set()
    rows = (
        db.query(SemanticChunk.source_id)
        .filter(SemanticChunk.source_id.in_(list(source_ids)))
        .distinct()
        .all()
    )
    return {row[0] for row in rows if row and isinstance(row[0], UUID)}


async def reindex_project(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    provider_config: Dict[str, Any],
    force: bool = False,
) -> Dict[str, int]:
    profile = get_embedding_profile(db, user_id=user_id, feature="search")
    if not profile:
        raise ValueError("Semantic embedding profile is not configured")

    refs = _project_object_refs(db, project_id=project_id)
    current_ref_set = {(object_type, object_id) for object_type, object_id in refs}
    existing_sources = (
        db.query(SemanticSource)
        .filter(SemanticSource.user_id == user_id, SemanticSource.project_id == project_id)
        .all()
    )
    for source in existing_sources:
        if (source.object_type, source.object_id) not in current_ref_set:
            db.delete(source)
    db.flush()

    indexed_sources = 0
    rebuilt_sources = 0
    skipped_sources = 0
    missing_main_language_sources = 0

    for object_type, object_id in refs:
        result = await index_object(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            provider_config=provider_config,
            force=force,
        )
        indexed_sources += 1
        if result.get("missing_main_language"):
            missing_main_language_sources += 1
        if result.get("rebuilt"):
            rebuilt_sources += 1
        elif result.get("skipped"):
            skipped_sources += 1

    return {
        "indexed_sources": indexed_sources,
        "rebuilt_sources": rebuilt_sources,
        "skipped_sources": skipped_sources,
        "missing_main_language_sources": missing_main_language_sources,
    }


def get_project_status(db: Session, *, user_id: UUID, project_id: UUID) -> Dict[str, Any]:
    refs = _project_object_refs(db, project_id=project_id)
    total_sources = len(refs)
    language = get_main_language(db, user_id=user_id)
    profile = get_embedding_profile(db, user_id=user_id, feature="search")

    sources = _load_project_sources(db, user_id=user_id, project_id=project_id, language=language)
    chunked_source_ids = _load_chunked_source_ids(
        db,
        source_ids=[source.id for source in sources.values()],
    )
    latest_versions = _latest_versions_for_refs(db, refs=refs)

    ready_sources = 0
    stale_sources = 0
    unindexed_sources = 0
    missing_sources = 0
    error_sources = 0

    current_provider = str(profile["provider"]) if profile else None
    current_model = str(profile["model"]) if profile else None

    for object_type, object_id in refs:
        payload = _build_current_payload(
            object_type=object_type,
            latest=latest_versions.get((object_type, object_id)),
            language=language,
        )
        if not payload.has_indexable_text:
            missing_sources += 1
            continue

        if not current_provider or not current_model:
            unindexed_sources += 1
            continue

        source = sources.get((object_type, object_id))
        if source is None:
            unindexed_sources += 1
            continue

        has_chunks = source.id in chunked_source_ids
        provider_match = source.indexed_provider == current_provider and source.indexed_model == current_model
        content_match = source.content_hash == payload.current_hash

        if has_chunks:
            if provider_match and content_match:
                ready_sources += 1
            else:
                stale_sources += 1
            continue

        attempted_match = (
            source.last_attempted_hash == payload.current_hash
            and source.last_attempted_provider == current_provider
            and source.last_attempted_model == current_model
        )
        if source.last_error_at is not None and attempted_match:
            error_sources += 1
        else:
            unindexed_sources += 1

    last_indexed = max(
        (
            source.indexed_at
            for source in sources.values()
            if source.id in chunked_source_ids and source.indexed_at is not None
        ),
        default=None,
    )

    return {
        "profile": profile,
        "total_sources": total_sources,
        "ready_sources": ready_sources,
        "stale_sources": stale_sources,
        "unindexed_sources": unindexed_sources,
        "missing_main_language_sources": missing_sources,
        "error_sources": error_sources,
        "last_indexed_at": last_indexed.isoformat() if last_indexed else None,
    }

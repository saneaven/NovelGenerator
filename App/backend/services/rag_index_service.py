from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import (
    BasicInfo,
    Guidelines,
    Character,
    Organization,
    Location,
    LorebookEntry,
    Outline,
    Act,
    Chapter,
    Manuscript,
    Project,
    UserSettings,
)
from ..models.translation_models import ObjectVersion
from ..models.rag_models import RagChunk, RagSource
from .embedding_config_service import get_embedding_profile, set_embedding_dimensions
from .rag_chunker import (
    merge_blocks_by_length,
    split_markdown_blocks,
    split_plaintext_blocks,
)
from .rag_embedding_service import embed_many
from .rag_text_extractors import extract_index_text


STORY_OBJECT_TYPES = {"basic_info", "guidelines", "character", "organization", "location", "lorebook"}
OUTLINE_TYPES = {"outline", "act", "chapter"}
MANUSCRIPT_TYPES = {"manuscript"}

TYPE_GROUP_ORDER = ["story_object", "outline", "manuscript"]

EXCLUDED_OBJECT_TYPES = {"basic_info", "guidelines"}

MIN_CHARS = 200
TARGET_CHARS = 600
MAX_CHARS = 1200


_WS_RE = re.compile(r"[ \t]+")
_MULTI_NL_RE = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class OrderMeta:
    type_group: str
    story_object_type: Optional[str] = None
    story_object_order: Optional[int] = None
    outline_order: Optional[int] = None
    act_order: Optional[int] = None
    chapter_order: Optional[int] = None
    chapter_id: Optional[UUID] = None


def wipe_user_index(db: Session, *, user_id: UUID) -> None:
    db.query(RagSource).filter(RagSource.user_id == user_id).delete(synchronize_session=False)


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
    for c in chunks:
        field_path = c.get("field_path")
        chunk_index = c.get("chunk_index")
        text = c.get("text")
        if not isinstance(field_path, str) or not isinstance(chunk_index, int) or not isinstance(text, str):
            continue
        t = normalize_for_hash(text)
        if not t:
            continue
        parts.append(f"[{field_path}:{chunk_index}]\n{t}\n")
    payload = "\n".join(parts).encode("utf-8")
    return sha256(payload).hexdigest()


def chunk_fields(text_by_field: Dict[str, str]) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    chunk_index = 0

    for field_path in ["content", "doc"]:
        raw = (text_by_field.get(field_path) or "").strip()
        if not raw:
            continue

        if field_path == "doc":
            blocks = split_plaintext_blocks(raw)
        else:
            blocks = split_markdown_blocks(raw)

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


def _latest_version(db: Session, *, object_type: str, object_id: UUID) -> Optional[ObjectVersion]:
    return (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )


def compute_order_meta(db: Session, *, project_id: UUID, object_type: str, object_id: UUID) -> OrderMeta:
    if object_type in STORY_OBJECT_TYPES:
        story_object_order: Optional[int] = None
        if object_type == "basic_info":
            story_object_order = 0
        elif object_type == "guidelines":
            story_object_order = 0
        elif object_type == "character":
            row = db.query(Character).filter(Character.id == object_id, Character.project_id == project_id).first()
            story_object_order = (row.order if row else 0) or 0
        elif object_type == "organization":
            row = db.query(Organization).filter(Organization.id == object_id, Organization.project_id == project_id).first()
            story_object_order = (row.order if row else 0) or 0
        elif object_type == "location":
            row = db.query(Location).filter(Location.id == object_id, Location.project_id == project_id).first()
            story_object_order = (row.order if row else 0) or 0
        elif object_type == "lorebook":
            row = db.query(LorebookEntry).filter(LorebookEntry.id == object_id, LorebookEntry.project_id == project_id).first()
            story_object_order = (row.order if row else 0) or 0

        return OrderMeta(
            type_group="story_object",
            story_object_type=object_type,
            story_object_order=story_object_order,
        )

    if object_type == "outline":
        outline = db.query(Outline).filter(Outline.id == object_id, Outline.project_id == project_id).first()
        outline_order = (outline.order if outline else 0) or 0
        return OrderMeta(type_group="outline", outline_order=outline_order)

    if object_type == "act":
        act = (
            db.query(Act)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Act.id == object_id, Outline.project_id == project_id)
            .first()
        )
        outline_order = (act.outline.order if act and act.outline else 0) or 0
        act_order = (act.order if act else 0) or 0
        return OrderMeta(type_group="outline", outline_order=outline_order, act_order=act_order)

    if object_type == "chapter":
        chapter = (
            db.query(Chapter)
            .join(Act, Act.id == Chapter.act_id)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Chapter.id == object_id, Outline.project_id == project_id)
            .first()
        )
        outline_order = (chapter.act.outline.order if chapter and chapter.act and chapter.act.outline else 0) or 0
        act_order = (chapter.act.order if chapter and chapter.act else 0) or 0
        chapter_order = (chapter.order if chapter else 0) or 0
        return OrderMeta(
            type_group="outline",
            outline_order=outline_order,
            act_order=act_order,
            chapter_order=chapter_order,
            chapter_id=object_id,
        )

    if object_type == "manuscript":
        ms = (
            db.query(Manuscript)
            .join(Chapter, Chapter.id == Manuscript.chapter_id)
            .join(Act, Act.id == Chapter.act_id)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Manuscript.id == object_id, Outline.project_id == project_id)
            .first()
        )
        if not ms or not ms.chapter or not ms.chapter.act or not ms.chapter.act.outline:
            return OrderMeta(type_group="manuscript")
        return OrderMeta(
            type_group="manuscript",
            outline_order=ms.chapter.act.outline.order,
            act_order=ms.chapter.act.order,
            chapter_order=ms.chapter.order,
            chapter_id=ms.chapter_id,
        )

    # Fallback: treat unknown types as story_object
    return OrderMeta(type_group="story_object", story_object_type=object_type, story_object_order=0)


def _upsert_source(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
    order_meta: OrderMeta,
) -> RagSource:
    source = (
        db.query(RagSource)
        .filter(
            RagSource.user_id == user_id,
            RagSource.project_id == project_id,
            RagSource.object_type == object_type,
            RagSource.object_id == object_id,
            RagSource.language == language,
        )
        .first()
    )
    if not source:
        source = RagSource(
            user_id=user_id,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            language=language,
            type_group=order_meta.type_group,
            story_object_type=order_meta.story_object_type,
            story_object_order=order_meta.story_object_order,
            outline_order=order_meta.outline_order,
            act_order=order_meta.act_order,
            chapter_order=order_meta.chapter_order,
            chapter_id=order_meta.chapter_id,
            index_state="ready",
        )
        db.add(source)
        db.flush()

    # Always refresh ordering metadata
    source.type_group = order_meta.type_group
    source.story_object_type = order_meta.story_object_type
    source.story_object_order = order_meta.story_object_order
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
    language = get_main_language(db, user_id=user_id)
    deleted = (
        db.query(RagSource)
        .filter(
            RagSource.user_id == user_id,
            RagSource.project_id == project_id,
            RagSource.object_type == object_type,
            RagSource.object_id == object_id,
            RagSource.language == language,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(deleted or 0)


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
    if object_type in EXCLUDED_OBJECT_TYPES:
        return {"rebuilt": False, "skipped": True, "missing_main_language": False}

    profile = get_embedding_profile(db, user_id=user_id, feature="ragSearch")
    if not profile:
        raise ValueError("RAG embedding profile is not configured")

    language = get_main_language(db, user_id=user_id)
    latest = _latest_version(db, object_type=object_type, object_id=object_id)

    order_meta = compute_order_meta(db, project_id=project_id, object_type=object_type, object_id=object_id)
    source = _upsert_source(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        language=language,
        order_meta=order_meta,
    )

    if not latest or not isinstance(latest.data, dict):
        source.index_state = "error"
        source.indexed_at = datetime.utcnow()
        db.commit()
        return {"rebuilt": False, "skipped": True, "missing_main_language": False}

    text_by_field = extract_index_text(object_type, latest.data, language)
    if not text_by_field or not any(v.strip() for v in text_by_field.values()):
        source.index_state = "missing_main_language"
        source.version_number = latest.version_number
        source.content_hash = None
        source.indexed_at = datetime.utcnow()
        db.query(RagChunk).filter(RagChunk.source_id == source.id).delete(synchronize_session=False)
        db.commit()
        return {"rebuilt": False, "skipped": True, "missing_main_language": True}

    chunks = chunk_fields(text_by_field)
    if not chunks:
        source.index_state = "ready"
        source.version_number = latest.version_number
        source.content_hash = compute_chunks_hash([])
        source.indexed_at = datetime.utcnow()
        db.query(RagChunk).filter(RagChunk.source_id == source.id).delete(synchronize_session=False)
        db.commit()
        return {"rebuilt": False, "skipped": True, "missing_main_language": False}

    name_prefix: Optional[str] = None
    if object_type in STORY_OBJECT_TYPES and object_type not in EXCLUDED_OBJECT_TYPES:
        name_prefix = (text_by_field.get("name") or "").strip() or None

    embedding_texts: List[str] = []
    hash_chunks: List[Dict[str, Any]] = []
    for c in chunks:
        embed_text = c["text"]
        if name_prefix and c["field_path"] == "content":
            embed_text = f"{name_prefix}\n\n{embed_text}"
        embedding_texts.append(embed_text)
        hash_chunks.append({"field_path": c["field_path"], "chunk_index": c["chunk_index"], "text": embed_text})

    new_hash = compute_chunks_hash(hash_chunks)

    if (not force) and source.content_hash == new_hash:
        source.index_state = "ready"
        source.version_number = latest.version_number
        source.indexed_at = datetime.utcnow()
        db.commit()
        return {"rebuilt": False, "skipped": True, "missing_main_language": False}

    vectors = await embed_many(
        provider=profile["provider"],
        model=profile["model"],
        inputs=embedding_texts,
        config=provider_config,
        purpose="document",
    )

    if not vectors:
        source.index_state = "error"
        source.version_number = latest.version_number
        source.indexed_at = datetime.utcnow()
        db.commit()
        return {"rebuilt": False, "skipped": True, "missing_main_language": False}

    embedding_dim = len(vectors[0])
    if any(len(v) != embedding_dim for v in vectors):
        raise RuntimeError("Embedding vectors have inconsistent dimensions")

    # Auto-fill profile dimensions on first successful embed (stored in user settings)
    stored_dim = profile.get("dimensions")
    if stored_dim is None:
        set_embedding_dimensions(db, user_id=user_id, feature="ragSearch", dimensions=embedding_dim)
    elif stored_dim != embedding_dim:
        raise RuntimeError(f"Embedding dimensions mismatch (profile={stored_dim}, got={embedding_dim})")

    # Rebuild chunks
    db.query(RagChunk).filter(RagChunk.source_id == source.id).delete(synchronize_session=False)
    for c, vec in zip(chunks, vectors):
        db.add(
            RagChunk(
                source_id=source.id,
                field_path=c["field_path"],
                chunk_index=c["chunk_index"],
                text=c["text"],
                embedding=vec,
                embedding_dim=embedding_dim,
            )
        )

    source.index_state = "ready"
    source.version_number = latest.version_number
    source.content_hash = new_hash
    source.indexed_at = datetime.utcnow()

    db.commit()
    return {"rebuilt": True, "skipped": False, "missing_main_language": False}


def _project_object_refs(db: Session, *, project_id: UUID) -> List[Tuple[str, UUID]]:
    """Return (object_type, object_id) pairs for a project."""
    refs: List[Tuple[str, UUID]] = []

    # Story objects (order within group is deterministic but not critical for indexing)
    for row in db.query(Character).filter(Character.project_id == project_id).order_by(Character.order.asc()).all():
        refs.append(("character", row.id))
    for row in db.query(Organization).filter(Organization.project_id == project_id).order_by(Organization.order.asc()).all():
        refs.append(("organization", row.id))
    for row in db.query(Location).filter(Location.project_id == project_id).order_by(Location.order.asc()).all():
        refs.append(("location", row.id))
    for row in db.query(LorebookEntry).filter(LorebookEntry.project_id == project_id).order_by(LorebookEntry.order.asc()).all():
        refs.append(("lorebook", row.id))

    # Outline items
    outlines = db.query(Outline).filter(Outline.project_id == project_id).order_by(Outline.order.asc()).all()
    for outline in outlines:
        refs.append(("outline", outline.id))
        for act in db.query(Act).filter(Act.outline_id == outline.id).order_by(Act.order.asc()).all():
            refs.append(("act", act.id))
            for chapter in db.query(Chapter).filter(Chapter.act_id == act.id).order_by(Chapter.order.asc()).all():
                refs.append(("chapter", chapter.id))

                ms = db.query(Manuscript).filter(Manuscript.chapter_id == chapter.id).first()
                if ms:
                    refs.append(("manuscript", ms.id))

    return refs


async def reindex_project(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    provider_config: Dict[str, Any],
    force: bool = False,
) -> Dict[str, int]:
    profile = get_embedding_profile(db, user_id=user_id, feature="ragSearch")
    if not profile:
        raise ValueError("RAG embedding profile is not configured")

    refs = _project_object_refs(db, project_id=project_id)

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
    base_filters = [
        RagSource.user_id == user_id,
        RagSource.project_id == project_id,
    ]

    total_sources = db.query(RagSource).filter(*base_filters).count()
    ready_sources = db.query(RagSource).filter(*base_filters, RagSource.index_state == "ready").count()
    missing_sources = db.query(RagSource).filter(*base_filters, RagSource.index_state == "missing_main_language").count()
    error_sources = db.query(RagSource).filter(*base_filters, RagSource.index_state == "error").count()

    last_indexed = (
        db.query(RagSource.indexed_at)
        .filter(*base_filters, RagSource.indexed_at.isnot(None))
        .order_by(RagSource.indexed_at.desc())
        .first()
    )

    profile = get_embedding_profile(db, user_id=user_id, feature="ragSearch")

    return {
        "profile": profile,
        "total_sources": total_sources,
        "ready_sources": ready_sources,
        "missing_main_language_sources": missing_sources,
        "error_sources": error_sources,
        "last_indexed_at": last_indexed[0].isoformat() if last_indexed and last_indexed[0] else None,
    }

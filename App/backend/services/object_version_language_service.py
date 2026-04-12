from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable
from uuid import UUID, uuid4

from sqlalchemy import and_, case, func
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session, selectinload

from ..models.translation_models import ObjectVersion, ObjectVersionLanguage


@dataclass(frozen=True)
class VersionProvenance:
    user_request: str | None
    created_at: datetime | None


def latest_version(db: Session, object_type: str, object_id: UUID, *, for_update: bool = False) -> ObjectVersion | None:
    query = (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
    )
    if for_update:
        query = query.with_for_update()
    return query.first()


def versions_desc_with_languages(db: Session, object_type: str, object_id: UUID) -> list[ObjectVersion]:
    return (
        db.query(ObjectVersion)
        .options(selectinload(ObjectVersion.languages))
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .all()
    )


def latest_version_with_language(
    db: Session,
    object_type: str,
    object_id: UUID,
    language: str,
) -> tuple[ObjectVersion, ObjectVersionLanguage | None] | None:
    latest = latest_version(db, object_type, object_id)
    if latest is None:
        return None
    lang_row = (
        db.query(ObjectVersionLanguage)
        .filter(ObjectVersionLanguage.version_id == latest.id, ObjectVersionLanguage.language == language)
        .first()
    )
    return latest, lang_row


def latest_version_with_all_languages(db: Session, object_type: str, object_id: UUID) -> ObjectVersion | None:
    return (
        db.query(ObjectVersion)
        .options(selectinload(ObjectVersion.languages))
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )


def latest_language_rows(
    db: Session,
    object_type: str,
    object_id: UUID,
    *,
    preferred_language: str | None = None,
    for_update: bool = False,
) -> tuple[ObjectVersion, list[ObjectVersionLanguage]] | None:
    latest = latest_version(db, object_type, object_id, for_update=for_update)
    if latest is None:
        return None

    query = db.query(ObjectVersionLanguage).filter(ObjectVersionLanguage.version_id == latest.id)
    if preferred_language:
        query = query.order_by(
            case((ObjectVersionLanguage.language == preferred_language, 0), else_=1),
            ObjectVersionLanguage.created_at.asc(),
        )
    else:
        query = query.order_by(ObjectVersionLanguage.created_at.asc(), ObjectVersionLanguage.language.asc())
    return latest, query.all()


def latest_payload_with_fallback(
    db: Session,
    object_type: str,
    object_id: UUID,
    preferred_language: str,
    *,
    for_update: bool = False,
) -> tuple[ObjectVersion, ObjectVersionLanguage | None] | None:
    """Return the latest version plus the best language row for prompt/tool paths.

    Public object reads use strict-latest semantics: missing requested language
    renders empty data. Internal prompt/tool paths intentionally prefer any
    latest-version language over no context, so this helper loads the bounded
    set of language rows for one latest version and orders the requested
    language first.
    """
    result = latest_language_rows(
        db,
        object_type,
        object_id,
        preferred_language=preferred_language,
        for_update=for_update,
    )
    if result is None:
        return None
    latest, rows = result
    return latest, (rows[0] if rows else None)


def payload_map_from_rows(rows: Iterable[ObjectVersionLanguage]) -> dict[str, Any]:
    return {
        str(row.language): row.data
        for row in rows
        if isinstance(row.data, dict)
    }


def _loaded_language_rows(version: ObjectVersion | object) -> list[ObjectVersionLanguage] | None:
    try:
        state = sa_inspect(version)
        if "languages" in state.unloaded:
            return None
    except Exception:
        pass
    rows = getattr(version, "languages", None)
    return list(rows) if rows is not None else None


def earliest_provenance_from_rows(
    rows: Iterable[ObjectVersionLanguage],
    *,
    fallback_created_at: datetime | None = None,
) -> VersionProvenance:
    usable = [row for row in rows if getattr(row, "created_at", None) is not None]
    if usable:
        row = min(usable, key=lambda item: item.created_at)
        return VersionProvenance(
            user_request=getattr(row, "user_request", None),
            created_at=getattr(row, "created_at", None),
        )
    return VersionProvenance(user_request=None, created_at=fallback_created_at)


def provenance_for_version(db: Session, version: ObjectVersion) -> VersionProvenance:
    rows = _loaded_language_rows(version)
    if rows:
        return earliest_provenance_from_rows(rows, fallback_created_at=version.created_at)
    row = (
        db.query(ObjectVersionLanguage.user_request, ObjectVersionLanguage.created_at)
        .filter(ObjectVersionLanguage.version_id == version.id)
        .order_by(ObjectVersionLanguage.created_at.asc())
        .first()
    )
    if row is None:
        return VersionProvenance(user_request=None, created_at=version.created_at)
    return VersionProvenance(user_request=row.user_request, created_at=row.created_at)


def provenance_map_for_versions(db: Session, version_ids: Iterable[UUID]) -> dict[UUID, VersionProvenance]:
    ids = list({version_id for version_id in version_ids if isinstance(version_id, UUID)})
    if not ids:
        return {}
    row_num = (
        func.row_number()
        .over(
            partition_by=ObjectVersionLanguage.version_id,
            order_by=ObjectVersionLanguage.created_at.asc(),
        )
        .label("rn")
    )
    subq = (
        db.query(
            ObjectVersionLanguage.version_id.label("version_id"),
            ObjectVersionLanguage.user_request.label("user_request"),
            ObjectVersionLanguage.created_at.label("created_at"),
            row_num,
        )
        .filter(ObjectVersionLanguage.version_id.in_(ids))
        .subquery()
    )
    rows = (
        db.query(subq.c.version_id, subq.c.user_request, subq.c.created_at)
        .filter(subq.c.rn == 1)
        .all()
    )
    return {
        row.version_id: VersionProvenance(user_request=row.user_request, created_at=row.created_at)
        for row in rows
    }


def create_version_with_language(
    db: Session,
    *,
    object_type: str,
    object_id: UUID,
    version_number: int,
    language: str,
    data: dict[str, Any],
    user_request: str,
    created_by: UUID | None,
    created_at: datetime | None = None,
    version_id: UUID | None = None,
) -> ObjectVersion:
    now = created_at or datetime.utcnow()
    version = ObjectVersion(
        id=version_id or uuid4(),
        object_type=object_type,
        object_id=object_id,
        version_number=version_number,
        created_by=created_by,
        created_at=now,
    )
    version.languages.append(
        ObjectVersionLanguage(
            language=language,
            data=data,
            user_request=user_request,
            created_by=created_by,
            created_at=now,
        )
    )
    db.add(version)
    db.flush()
    return version


def upsert_version_language(
    db: Session,
    *,
    version: ObjectVersion,
    language: str,
    data: dict[str, Any],
    user_request: str,
    created_by: UUID | None,
    created_at: datetime | None = None,
) -> ObjectVersionLanguage:
    now = created_at or datetime.utcnow()
    row = (
        db.query(ObjectVersionLanguage)
        .filter(ObjectVersionLanguage.version_id == version.id, ObjectVersionLanguage.language == language)
        .first()
    )
    if row is None:
        row = ObjectVersionLanguage(
            version_id=version.id,
            language=language,
            data=data,
            user_request=user_request,
            created_by=created_by,
            created_at=now,
        )
        db.add(row)
        loaded_rows = _loaded_language_rows(version)
        if loaded_rows is not None and row not in loaded_rows:
            version.languages.append(row)
    else:
        row.data = data
        row.user_request = user_request
        row.created_by = created_by
        row.created_at = now
    db.flush()
    return row


def latest_parents_for_object_ids(
    db: Session,
    *,
    object_type: str,
    object_ids: Iterable[UUID],
) -> list[ObjectVersion]:
    ids = list({object_id for object_id in object_ids if isinstance(object_id, UUID)})
    if not ids:
        return []

    subq = (
        db.query(
            ObjectVersion.object_id.label("object_id"),
            func.max(ObjectVersion.version_number).label("max_version"),
        )
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id.in_(ids))
        .group_by(ObjectVersion.object_id)
        .subquery()
    )
    return (
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

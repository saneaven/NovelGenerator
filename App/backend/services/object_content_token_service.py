from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from ..models.db_models import (
    BasicInfo,
    Guidelines,
    Manuscript,
    Outline,
    StoryEntity,
    Timeline,
    TimelineEvent,
    TimelineTrack,
)
from ..utils.story_entities import STORY_ENTITY_TYPE
from ..utils.timeline_calendar import default_calendar, format_date
from .ownership import require_owned_project
from .object_service import _serialize_object


SELECTABLE_OBJECT_TYPES = (
    "basic_info",
    "guidelines",
    STORY_ENTITY_TYPE,
    "outline",
    "manuscript",
    "timeline_track",
    "timeline_event",
)

OBJECT_TYPE_ORDER = {object_type: index for index, object_type in enumerate(SELECTABLE_OBJECT_TYPES)}


@dataclass(frozen=True)
class SelectedObject:
    object_type: str
    row: Any
    serialized: dict[str, Any]
    order: int


def _add(parts: list[str], label: str, value: Any) -> None:
    if value is None:
        return
    if isinstance(value, list):
        text = ", ".join(str(item).strip() for item in value if str(item).strip())
    else:
        text = str(value).strip()
    if text:
        parts.append(f"{label}: {text}")


def _data(item: dict[str, Any]) -> dict[str, Any]:
    value = item.get("data")
    return value if isinstance(value, dict) else {}


def _metadata(item: dict[str, Any]) -> dict[str, Any]:
    value = item.get("metadata")
    return value if isinstance(value, dict) else {}


def _timeline_date_range_text(
    *,
    start_date: Any,
    end_date: Any,
    calendar: dict[str, Any],
) -> str:
    if not isinstance(start_date, dict):
        return ""
    start = format_date(start_date, calendar)
    if not isinstance(end_date, dict) or end_date == start_date:
        return start
    return f"{start} - {format_date(end_date, calendar)}"


def _timeline_calendar(db: Session, project_id: UUID) -> dict[str, Any]:
    row = db.query(Timeline).filter(Timeline.project_id == project_id).first()
    if row is None or not isinstance(row.calendar, dict):
        return default_calendar()
    return row.calendar


def _serialize(
    db: Session,
    *,
    object_type: str,
    row: Any,
    language: str,
    fallback_language: str,
) -> dict[str, Any]:
    return _serialize_object(
        db,
        object_type,
        row,
        language,
        rich_text_format="markdown",
        fallback_language=fallback_language,
        include_content=True,
    )


def _load_selected_objects(
    db: Session,
    *,
    project_id: UUID,
    object_ids: Iterable[UUID],
    language: str,
) -> list[SelectedObject]:
    requested_ids = list(dict.fromkeys(object_ids))
    if not requested_ids:
        return []

    requested = set(requested_ids)
    order_by_id = {object_id: index for index, object_id in enumerate(requested_ids)}
    fallback_language = language or "English"
    out: list[SelectedObject] = []

    def add_rows(object_type: str, rows: Iterable[Any]) -> None:
        for row in rows:
            out.append(
                SelectedObject(
                    object_type=object_type,
                    row=row,
                    serialized=_serialize(
                        db,
                        object_type=object_type,
                        row=row,
                        language=language,
                        fallback_language=fallback_language,
                    ),
                    order=order_by_id.get(row.id, len(order_by_id)),
                )
            )

    add_rows(
        "basic_info",
        db.query(BasicInfo)
        .filter(BasicInfo.project_id == project_id, BasicInfo.id.in_(requested))
        .all(),
    )
    add_rows(
        "guidelines",
        db.query(Guidelines)
        .filter(Guidelines.project_id == project_id, Guidelines.id.in_(requested))
        .all(),
    )
    add_rows(
        STORY_ENTITY_TYPE,
        db.query(StoryEntity)
        .filter(StoryEntity.project_id == project_id, StoryEntity.id.in_(requested))
        .all(),
    )
    add_rows(
        "outline",
        db.query(Outline)
        .filter(Outline.project_id == project_id, Outline.id.in_(requested))
        .options(joinedload(Outline.manuscript), joinedload(Outline.parent))
        .all(),
    )
    add_rows(
        "manuscript",
        db.query(Manuscript)
        .join(Outline, Outline.id == Manuscript.chapter_id)
        .filter(Outline.project_id == project_id, Outline.kind == "chapter", Manuscript.id.in_(requested))
        .options(joinedload(Manuscript.chapter).joinedload(Outline.parent).joinedload(Outline.parent))
        .all(),
    )
    add_rows(
        "timeline_track",
        db.query(TimelineTrack)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id, TimelineTrack.id.in_(requested))
        .all(),
    )
    add_rows(
        "timeline_event",
        db.query(TimelineEvent)
        .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id, TimelineEvent.id.in_(requested))
        .options(joinedload(TimelineEvent.track))
        .all(),
    )

    out.sort(key=lambda item: (item.order, OBJECT_TYPE_ORDER.get(item.object_type, 999), str(item.row.id)))
    return out


def _chapter_name(db: Session, *, selected: SelectedObject, language: str) -> str:
    chapter = getattr(selected.row, "chapter", None)
    if chapter is None:
        return ""
    serialized = _serialize(
        db,
        object_type="outline",
        row=chapter,
        language=language,
        fallback_language=language or "English",
    )
    value = _data(serialized).get("name")
    return str(value or "")


def _track_name(db: Session, *, selected: SelectedObject, language: str) -> str:
    track = getattr(selected.row, "track", None)
    if track is None:
        track = db.query(TimelineTrack).filter(TimelineTrack.id == getattr(selected.row, "track_id", None)).first()
    if track is None:
        return ""
    serialized = _serialize(
        db,
        object_type="timeline_track",
        row=track,
        language=language,
        fallback_language=language or "English",
    )
    value = _data(serialized).get("name")
    return str(value or "")


def token_text_for_selected_object(
    db: Session,
    selected: SelectedObject,
    *,
    language: str,
    timeline_calendar: dict[str, Any],
) -> str:
    object_type = selected.object_type
    item = selected.serialized
    data = _data(item)
    metadata = _metadata(item)
    parts: list[str] = []

    if object_type == "basic_info":
        _add(parts, "Object type", "basic_info")
        _add(parts, "Title", data.get("title"))
        _add(parts, "Logline", data.get("logline"))
        _add(parts, "Genres", data.get("genres"))
        _add(parts, "Tags", data.get("tags"))
    elif object_type == "guidelines":
        _add(parts, "Object type", "guidelines")
        _add(parts, "Author note", data.get("authorNote"))
    elif object_type == STORY_ENTITY_TYPE:
        _add(parts, "Object type", STORY_ENTITY_TYPE)
        _add(parts, "Kind", item.get("kind") or metadata.get("kind"))
        _add(parts, "Name", data.get("name"))
        _add(parts, "Description", data.get("description"))
        _add(parts, "Content", data.get("content"))
    elif object_type == "outline":
        _add(parts, "Object type", "outline")
        _add(parts, "Kind", item.get("kind") or metadata.get("kind"))
        _add(parts, "Name", data.get("name"))
        _add(parts, "Description", data.get("description"))
        _add(parts, "Content", data.get("content"))
    elif object_type == "manuscript":
        _add(parts, "Object type", "manuscript")
        _add(parts, "Chapter", _chapter_name(db, selected=selected, language=language))
        _add(parts, "Content", data.get("content"))
    elif object_type == "timeline_track":
        _add(parts, "Object type", "timeline_track")
        _add(parts, "Name", data.get("name"))
        _add(parts, "Description", data.get("description"))
        _add(parts, "Content", data.get("content"))
    elif object_type == "timeline_event":
        _add(parts, "Object type", "timeline_event")
        _add(parts, "Track", _track_name(db, selected=selected, language=language))
        _add(
            parts,
            "Date",
            _timeline_date_range_text(
                start_date=metadata.get("start_date"),
                end_date=metadata.get("end_date"),
                calendar=timeline_calendar,
            ),
        )
        _add(parts, "Name", data.get("name"))
        _add(parts, "Description", data.get("description"))
        _add(parts, "Content", data.get("content"))
        _add(parts, "Tags", metadata.get("tags"))

    return "\n".join(parts)


def build_selected_object_token_text(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    object_ids: Iterable[UUID],
    language: str,
) -> str:
    require_owned_project(db, user_id=user_id, project_id=project_id)
    selected = _load_selected_objects(
        db,
        project_id=project_id,
        object_ids=object_ids,
        language=language,
    )
    if not selected:
        return ""

    calendar = _timeline_calendar(db, project_id)
    return "\n\n".join(
        text
        for text in (
            token_text_for_selected_object(
                db,
                item,
                language=language,
                timeline_calendar=calendar,
            )
            for item in selected
        )
        if text
    )

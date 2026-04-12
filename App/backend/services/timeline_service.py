from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any, Iterable
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.db_models import (
    Project,
    Timeline,
    TimelineEvent,
    TimelineEventLink,
    TimelineTrack,
)
from ..models.translation_models import ObjectVersion, ObjectVersionLanguage
from ..services.deletion_service import delete_object_versions_bulk, delete_semantic_sources_bulk
from ..services.object_change_events import queue_object_change
from ..services.ownership import resolve_project_id_for_object
from ..services.storage_usage_service import (
    build_object_version_delta,
    build_story_core_delta,
    build_story_core_rows_delta,
    build_usage_delta_for_measurement_rows,
    apply_project_usage_delta,
    apply_project_usage_deltas,
    measure_object_version_row,
    snapshot_object_version_row,
    snapshot_rows,
    snapshot_story_core_row,
)
from ..utils.timeline_calendar import (
    default_calendar,
    format_date,
    migrate_dates,
    normalize_calendar,
    to_base_units,
    validate_date,
)
from .object_version_language_service import (
    create_version_with_language,
    latest_payload_with_fallback,
    latest_parents_for_object_ids,
    payload_map_from_rows,
    provenance_map_for_versions,
    upsert_version_language,
)


TIMELINE_TRACK_TYPE = "timeline_track"
TIMELINE_EVENT_TYPE = "timeline_event"
ALLOWED_LINK_TYPES = {"outline", "story_entity"}
_UNSET = object()


def _timeline_query(db: Session, project_id: UUID):
    return db.query(Timeline).filter(Timeline.project_id == project_id)


def _track_query(db: Session, project_id: UUID):
    return (
        db.query(TimelineTrack)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
    )


def _event_query(db: Session, project_id: UUID):
    return (
        db.query(TimelineEvent)
        .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
    )


def _event_link_query(db: Session, project_id: UUID):
    return (
        db.query(TimelineEventLink)
        .join(TimelineEvent, TimelineEvent.id == TimelineEventLink.event_id)
        .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
    )


def _latest_version(db: Session, object_type: str, object_id: UUID) -> ObjectVersion | None:
    return (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )


def _latest_versions_map(
    db: Session,
    object_type: str,
    object_ids: Iterable[UUID],
    *,
    language: str | None = None,
) -> dict[UUID, tuple[ObjectVersion, list[ObjectVersionLanguage], datetime | None]]:
    ids = list({object_id for object_id in object_ids})
    if not ids:
        return {}

    parents = latest_parents_for_object_ids(db, object_type=object_type, object_ids=ids)
    version_ids = [row.id for row in parents if isinstance(row.id, UUID)]
    if not version_ids:
        return {}

    lang_query = db.query(ObjectVersionLanguage).filter(ObjectVersionLanguage.version_id.in_(version_ids))
    if language:
        lang_query = lang_query.filter(ObjectVersionLanguage.language == language)
    lang_rows = lang_query.order_by(ObjectVersionLanguage.created_at.asc()).all()
    rows_by_version_id: dict[UUID, list[ObjectVersionLanguage]] = {}
    for row in lang_rows:
        rows_by_version_id.setdefault(row.version_id, []).append(row)

    provenance_by_version_id = provenance_map_for_versions(db, version_ids)
    return {
        row.object_id: (
            row,
            rows_by_version_id.get(row.id, []),
            provenance_by_version_id.get(row.id, None).created_at
            if provenance_by_version_id.get(row.id, None) is not None
            else row.created_at,
        )
        for row in parents
    }


def _extract_version_payload(
    version_entry: tuple[ObjectVersion, list[ObjectVersionLanguage], datetime | None] | None,
    language: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if version_entry is None:
        return {}, {"id": None, "number": 0, "created_at": None}

    version, rows, created_at = version_entry
    if language:
        data = {
            row.language: row.data
            for row in rows
            if row.language == language and isinstance(row.data, dict)
        }
    else:
        data = payload_map_from_rows(rows)

    return data, {
        "id": str(version.id),
        "number": int(version.version_number),
        "created_at": created_at.isoformat() if created_at else None,
    }


def _version_entry_for_parent(
    db: Session,
    version: ObjectVersion | None,
    *,
    language: str | None,
) -> tuple[ObjectVersion, list[ObjectVersionLanguage], datetime | None] | None:
    if version is None:
        return None
    query = db.query(ObjectVersionLanguage).filter(ObjectVersionLanguage.version_id == version.id)
    if language:
        query = query.filter(ObjectVersionLanguage.language == language)
    rows = query.order_by(ObjectVersionLanguage.created_at.asc()).all()
    provenance = provenance_map_for_versions(db, [version.id]).get(version.id)
    return version, rows, provenance.created_at if provenance is not None else version.created_at


def _content_payload(name: str, description: str, content: Any = None, *, rich_text_format: str = "tiptap") -> dict[str, Any]:
    from .object_service import _normalize_rich_value
    return {
        "name": str(name or ""),
        "description": str(description or ""),
        "content": _normalize_rich_value(content, rich_text_format=rich_text_format),
    }


def _sanitize_tags(tags: Iterable[Any] | None) -> list[str]:
    if tags is None:
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in tags:
        tag = str(raw or "").strip()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        cleaned.append(tag)
    return cleaned


def _validate_event_dates(
    *,
    start_date: dict[str, Any],
    end_date: dict[str, Any] | None,
    calendar: dict[str, Any],
) -> None:
    units = calendar.get("units", [])
    if not validate_date(start_date, units):
        raise HTTPException(status_code=400, detail="Invalid start_date for calendar")
    if end_date is not None and not validate_date(end_date, units):
        raise HTTPException(status_code=400, detail="Invalid end_date for calendar")
    if end_date is not None and to_base_units(end_date, units) < to_base_units(start_date, units):
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")


def _track_siblings(
    db: Session,
    *,
    timeline_id: UUID,
    parent_id: UUID | None,
    exclude_id: UUID | None = None,
) -> list[TimelineTrack]:
    query = (
        db.query(TimelineTrack)
        .filter(TimelineTrack.timeline_id == timeline_id, TimelineTrack.parent_id == parent_id)
        .order_by(TimelineTrack.position.asc(), TimelineTrack.created_at.asc(), TimelineTrack.id.asc())
    )
    if exclude_id is not None:
        query = query.filter(TimelineTrack.id != exclude_id)
    return query.all()


def _normalize_track_positions(
    db: Session,
    *,
    timeline_id: UUID,
    parent_id: UUID | None,
    exclude_id: UUID | None = None,
) -> list[TimelineTrack]:
    siblings = _track_siblings(
        db,
        timeline_id=timeline_id,
        parent_id=parent_id,
        exclude_id=exclude_id,
    )
    for index, sibling in enumerate(siblings):
        sibling.position = index
    db.flush()
    return siblings


def _insert_track_position(
    db: Session,
    *,
    track: TimelineTrack,
    timeline_id: UUID,
    parent_id: UUID | None,
    requested_position: int | None,
) -> None:
    siblings = _normalize_track_positions(
        db,
        timeline_id=timeline_id,
        parent_id=parent_id,
        exclude_id=track.id,
    )
    max_position = len(siblings)
    new_position = max_position if requested_position is None else min(max(int(requested_position), 0), max_position)
    for sibling in siblings:
        if int(sibling.position or 0) >= new_position:
            sibling.position = int(sibling.position or 0) + 1
    track.parent_id = parent_id
    track.position = new_position
    db.flush()


def _collect_track_descendant_ids(
    rows: Iterable[TimelineTrack],
    *,
    root_id: UUID,
) -> list[UUID]:
    children_by_parent: dict[UUID | None, list[UUID]] = {}
    for row in rows:
        children_by_parent.setdefault(row.parent_id, []).append(row.id)

    out = [root_id]
    pending = list(children_by_parent.get(root_id, []))
    while pending:
        current = pending.pop(0)
        out.append(current)
        pending.extend(children_by_parent.get(current, []))
    return out


def _move_track(
    db: Session,
    *,
    track: TimelineTrack,
    new_parent_id: UUID | None,
    new_position: int | None,
) -> None:
    if new_parent_id == track.id:
        raise HTTPException(status_code=400, detail="Track cannot be moved under itself")

    timeline_id = track.timeline_id
    if new_parent_id is not None:
        parent = (
            db.query(TimelineTrack)
            .filter(TimelineTrack.id == new_parent_id, TimelineTrack.timeline_id == timeline_id)
            .first()
        )
        if parent is None:
            raise HTTPException(status_code=404, detail="Parent track not found")

        all_rows = db.query(TimelineTrack).filter(TimelineTrack.timeline_id == timeline_id).all()
        descendant_ids = set(_collect_track_descendant_ids(all_rows, root_id=track.id))
        if new_parent_id in descendant_ids:
            raise HTTPException(status_code=400, detail="Track cannot be moved under its descendant")

    current_parent_id = track.parent_id
    if new_parent_id == current_parent_id:
        siblings = _normalize_track_positions(
            db,
            timeline_id=timeline_id,
            parent_id=current_parent_id,
            exclude_id=track.id,
        )
        max_position = len(siblings)
        target_position = int(track.position or 0) if new_position is None else min(max(int(new_position), 0), max_position)
        for sibling in siblings:
            if int(sibling.position or 0) >= target_position:
                sibling.position = int(sibling.position or 0) + 1
        track.position = target_position
        db.flush()
        _normalize_track_positions(db, timeline_id=timeline_id, parent_id=current_parent_id)
        return

    _normalize_track_positions(
        db,
        timeline_id=timeline_id,
        parent_id=current_parent_id,
        exclude_id=track.id,
    )
    _insert_track_position(
        db,
        track=track,
        timeline_id=timeline_id,
        parent_id=new_parent_id,
        requested_position=new_position,
    )
    _normalize_track_positions(db, timeline_id=timeline_id, parent_id=current_parent_id)
    _normalize_track_positions(db, timeline_id=timeline_id, parent_id=new_parent_id)


def _create_or_update_version(
    db: Session,
    *,
    object_type: str,
    object_id: UUID,
    language: str,
    new_data: dict[str, Any],
    user_request: str,
    created_by: UUID,
    create_new_version: bool,
) -> ObjectVersion:
    latest = _latest_version(db, object_type, object_id)
    if latest is None:
        return create_version_with_language(
            db,
            object_type=object_type,
            object_id=object_id,
            version_number=1,
            language=language,
            data=new_data,
            user_request=user_request,
            created_by=created_by,
        )

    if create_new_version:
        return create_version_with_language(
            db,
            object_type=object_type,
            object_id=object_id,
            version_number=int(latest.version_number or 0) + 1,
            language=language,
            data=new_data,
            user_request=user_request,
            created_by=created_by,
        )

    upsert_version_language(
        db,
        version=latest,
        language=language,
        data=new_data,
        user_request=user_request,
        created_by=created_by,
    )
    return latest


def _serialize_link(link: TimelineEventLink) -> dict[str, Any]:
    return {
        "id": str(link.id),
        "event_id": str(link.event_id),
        "object_type": str(link.object_type),
        "object_id": str(link.object_id),
        "created_at": link.created_at.isoformat() if link.created_at else None,
    }


def _serialize_event(
    event: TimelineEvent,
    *,
    language: str | None,
    version_map: dict[UUID, tuple[ObjectVersion, list[ObjectVersionLanguage], datetime | None]],
    links_by_event_id: dict[UUID, list[TimelineEventLink]],
) -> dict[str, Any]:
    data, version = _extract_version_payload(version_map.get(event.id), language)
    return {
        "id": str(event.id),
        "track_id": str(event.track_id),
        "start_date": deepcopy(event.start_date) if isinstance(event.start_date, dict) else {},
        "end_date": deepcopy(event.end_date) if isinstance(event.end_date, dict) else None,
        "tags": _sanitize_tags(event.tags if isinstance(event.tags, list) else []),
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "updated_at": event.updated_at.isoformat() if event.updated_at else None,
        "data": data,
        "version": version,
        "links": [_serialize_link(link) for link in links_by_event_id.get(event.id, [])],
    }


def _serialize_track_tree(
    track: TimelineTrack,
    *,
    language: str | None,
    track_versions: dict[UUID, tuple[ObjectVersion, list[ObjectVersionLanguage], datetime | None]],
    events_by_track_id: dict[UUID, list[TimelineEvent]],
    event_versions: dict[UUID, tuple[ObjectVersion, list[ObjectVersionLanguage], datetime | None]],
    links_by_event_id: dict[UUID, list[TimelineEventLink]],
    children_by_parent_id: dict[UUID | None, list[TimelineTrack]],
) -> dict[str, Any]:
    data, version = _extract_version_payload(track_versions.get(track.id), language)
    return {
        "id": str(track.id),
        "timeline_id": str(track.timeline_id),
        "parent_id": str(track.parent_id) if track.parent_id else None,
        "position": int(track.position or 0),
        "color": track.color,
        "created_at": track.created_at.isoformat() if track.created_at else None,
        "updated_at": track.updated_at.isoformat() if track.updated_at else None,
        "data": data,
        "version": version,
        "events": [
            _serialize_event(
                event,
                language=language,
                version_map=event_versions,
                links_by_event_id=links_by_event_id,
            )
            for event in events_by_track_id.get(track.id, [])
        ],
        "children": [
            _serialize_track_tree(
                child,
                language=language,
                track_versions=track_versions,
                events_by_track_id=events_by_track_id,
                event_versions=event_versions,
                links_by_event_id=links_by_event_id,
                children_by_parent_id=children_by_parent_id,
            )
            for child in children_by_parent_id.get(track.id, [])
        ],
    }


class TimelineService:
    def get_timeline(self, db: Session, *, project_id: UUID) -> Timeline | None:
        return _timeline_query(db, project_id).first()

    def get_or_create_timeline(
        self,
        db: Session,
        *,
        project_id: UUID,
        user_id: UUID | None = None,
    ) -> Timeline:
        timeline = self.get_timeline(db, project_id=project_id)
        if timeline is not None:
            return timeline

        timeline = Timeline(
            id=uuid4(),
            project_id=project_id,
            calendar=default_calendar(),
        )
        db.add(timeline)
        db.flush()

        if user_id is not None:
            apply_project_usage_delta(
                db,
                user_id=user_id,
                project_id=project_id,
                delta=build_story_core_delta(None, snapshot_story_core_row(timeline)),
                enforce_quota=True,
            )
        return timeline

    def get_full_timeline(
        self,
        db: Session,
        *,
        project_id: UUID,
        language: str | None = None,
        tags_filter: list[str] | None = None,
        ensure_exists: bool = False,
        user_id: UUID | None = None,
        warnings: list[str] | None = None,
    ) -> dict[str, Any]:
        timeline = (
            self.get_or_create_timeline(db, project_id=project_id, user_id=user_id)
            if ensure_exists
            else self.get_timeline(db, project_id=project_id)
        )
        if timeline is None:
            return {
                "id": "",
                "project_id": str(project_id),
                "calendar": default_calendar(),
                "tracks": [],
                "warnings": warnings or [],
            }

        tracks = (
            db.query(TimelineTrack)
            .filter(TimelineTrack.timeline_id == timeline.id)
            .order_by(TimelineTrack.parent_id.asc().nullsfirst(), TimelineTrack.position.asc(), TimelineTrack.created_at.asc())
            .all()
        )
        events = (
            db.query(TimelineEvent)
            .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
            .filter(TimelineTrack.timeline_id == timeline.id)
            .order_by(TimelineEvent.created_at.asc(), TimelineEvent.id.asc())
            .all()
        )
        links = (
            db.query(TimelineEventLink)
            .join(TimelineEvent, TimelineEvent.id == TimelineEventLink.event_id)
            .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
            .filter(TimelineTrack.timeline_id == timeline.id)
            .order_by(TimelineEventLink.created_at.asc(), TimelineEventLink.id.asc())
            .all()
        )

        tag_filter_set = set(_sanitize_tags(tags_filter))
        if tag_filter_set:
            events = [
                event for event in events
                if tag_filter_set.intersection(_sanitize_tags(event.tags if isinstance(event.tags, list) else []))
            ]

        track_versions = _latest_versions_map(db, TIMELINE_TRACK_TYPE, [track.id for track in tracks], language=language)
        event_versions = _latest_versions_map(db, TIMELINE_EVENT_TYPE, [event.id for event in events], language=language)

        children_by_parent_id: dict[UUID | None, list[TimelineTrack]] = {}
        for track in tracks:
            children_by_parent_id.setdefault(track.parent_id, []).append(track)

        events_by_track_id: dict[UUID, list[TimelineEvent]] = {}
        included_event_ids = {event.id for event in events}
        for event in events:
            events_by_track_id.setdefault(event.track_id, []).append(event)

        links_by_event_id: dict[UUID, list[TimelineEventLink]] = {}
        for link in links:
            if link.event_id not in included_event_ids:
                continue
            links_by_event_id.setdefault(link.event_id, []).append(link)

        return {
            "id": str(timeline.id),
            "project_id": str(timeline.project_id),
            "calendar": deepcopy(timeline.calendar) if isinstance(timeline.calendar, dict) else default_calendar(),
            "tracks": [
                _serialize_track_tree(
                    track,
                    language=language,
                    track_versions=track_versions,
                    events_by_track_id=events_by_track_id,
                    event_versions=event_versions,
                    links_by_event_id=links_by_event_id,
                    children_by_parent_id=children_by_parent_id,
                )
                for track in children_by_parent_id.get(None, [])
            ],
            "warnings": warnings or [],
        }

    def list_tracks(
        self,
        db: Session,
        *,
        project_id: UUID,
        language: str | None = None,
        user_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        timeline = self.get_full_timeline(
            db,
            project_id=project_id,
            language=language,
            ensure_exists=True,
            user_id=user_id,
        )
        return list(timeline["tracks"])

    def list_events(
        self,
        db: Session,
        *,
        project_id: UUID,
        language: str | None = None,
        track_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        _ = user_id
        query = _event_query(db, project_id).order_by(
            TimelineEvent.created_at.asc(),
            TimelineEvent.id.asc(),
        )
        if track_id is not None:
            query = query.filter(TimelineEvent.track_id == track_id)
        events = query.all()
        event_versions = _latest_versions_map(db, TIMELINE_EVENT_TYPE, [event.id for event in events], language=language)
        links = _event_link_query(db, project_id).all()
        links_by_event_id: dict[UUID, list[TimelineEventLink]] = {}
        for link in links:
            links_by_event_id.setdefault(link.event_id, []).append(link)
        return [
            _serialize_event(
                event,
                language=language,
                version_map=event_versions,
                links_by_event_id=links_by_event_id,
            )
            for event in events
        ]

    def list_event_links(
        self,
        db: Session,
        *,
        project_id: UUID,
        event_id: UUID,
        user_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        _ = user_id
        links = (
            _event_link_query(db, project_id)
            .filter(TimelineEventLink.event_id == event_id)
            .order_by(TimelineEventLink.created_at.asc(), TimelineEventLink.id.asc())
            .all()
        )
        return [_serialize_link(link) for link in links]

    def update_calendar(
        self,
        db: Session,
        *,
        project_id: UUID,
        new_calendar: dict[str, Any],
        user_id: UUID,
        language: str | None = None,
    ) -> dict[str, Any]:
        timeline = self.get_or_create_timeline(db, project_id=project_id, user_id=user_id)
        normalized = normalize_calendar(new_calendar)

        story_core_before = snapshot_rows([timeline], snapshot_story_core_row)
        events = (
            db.query(TimelineEvent)
            .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
            .filter(TimelineTrack.timeline_id == timeline.id)
            .all()
        )
        story_core_before.extend(snapshot_rows(events, snapshot_story_core_row))

        migrated_dates, warnings = migrate_dates(
            timeline.calendar if isinstance(timeline.calendar, dict) else default_calendar(),
            normalized,
            [event.start_date for event in events],
        )
        migrated_end_dates, end_warnings = migrate_dates(
            timeline.calendar if isinstance(timeline.calendar, dict) else default_calendar(),
            normalized,
            [event.end_date for event in events],
        )
        warnings.extend(end_warnings)

        timeline.calendar = normalized
        for index, event in enumerate(events):
            event.start_date = migrated_dates[index]
            event.end_date = migrated_end_dates[index]
            _validate_event_dates(
                start_date=event.start_date if isinstance(event.start_date, dict) else {},
                end_date=event.end_date if isinstance(event.end_date, dict) else None,
                calendar=normalized,
            )

        db.flush()

        story_core_after = snapshot_rows([timeline], snapshot_story_core_row)
        story_core_after.extend(snapshot_rows(events, snapshot_story_core_row))
        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=project_id,
            deltas=[build_story_core_rows_delta(story_core_before, story_core_after)],
            enforce_quota=True,
        )

        for event in events:
            queue_object_change(
                db,
                user_id=user_id,
                project_id=project_id,
                object_type=TIMELINE_EVENT_TYPE,
                object_id=event.id,
                action="updated",
            )

        return self.get_full_timeline(
            db,
            project_id=project_id,
            language=language,
            warnings=list(dict.fromkeys(warnings)),
        )

    def create_track(
        self,
        db: Session,
        *,
        project_id: UUID,
        language: str,
        name: str,
        description: str,
        content: Any = None,
        rich_text_format: str = "tiptap",
        parent_id: UUID | None,
        position: int | None,
        color: str | None,
        user_request: str,
        user_id: UUID,
    ) -> dict[str, Any]:
        timeline = self.get_or_create_timeline(db, project_id=project_id, user_id=user_id)
        if parent_id is not None:
            parent = (
                db.query(TimelineTrack)
                .filter(TimelineTrack.id == parent_id, TimelineTrack.timeline_id == timeline.id)
                .first()
            )
            if parent is None:
                raise HTTPException(status_code=404, detail="Parent track not found")

        track = TimelineTrack(
            id=uuid4(),
            timeline_id=timeline.id,
            parent_id=parent_id,
            position=0,
            color=(str(color).strip() or None) if color is not None else None,
        )
        db.add(track)
        db.flush()
        _insert_track_position(
            db,
            track=track,
            timeline_id=timeline.id,
            parent_id=parent_id,
            requested_position=position,
        )

        version = _create_or_update_version(
            db,
            object_type=TIMELINE_TRACK_TYPE,
            object_id=track.id,
            language=language,
            new_data=_content_payload(name, description, content, rich_text_format=rich_text_format),
            user_request=user_request,
            created_by=user_id,
            create_new_version=True,
        )

        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=TIMELINE_TRACK_TYPE,
            object_id=track.id,
            action="created",
        )
        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=project_id,
            deltas=[
                build_story_core_delta(None, snapshot_story_core_row(track)),
                build_object_version_delta(
                    object_type=TIMELINE_TRACK_TYPE,
                    before=None,
                    after=snapshot_object_version_row(version),
                ),
            ],
            enforce_quota=True,
        )
        return _serialize_track_tree(
            track,
            language=language,
            track_versions={track.id: _version_entry_for_parent(db, version, language=language)},
            events_by_track_id={},
            event_versions={},
            links_by_event_id={},
            children_by_parent_id={},
        )

    def update_track(
        self,
        db: Session,
        *,
        project_id: UUID,
        track_id: UUID,
        language: str | None,
        name: str | None,
        description: str | None,
        content: Any = _UNSET,
        rich_text_format: str = "tiptap",
        color: Any = _UNSET,
        user_request: str,
        create_new_version: bool,
        user_id: UUID,
    ) -> dict[str, Any]:
        track = _track_query(db, project_id).filter(TimelineTrack.id == track_id).first()
        if track is None:
            raise HTTPException(status_code=404, detail="Timeline track not found")

        story_core_before = snapshot_story_core_row(track)
        version_before = snapshot_object_version_row(_latest_version(db, TIMELINE_TRACK_TYPE, track.id))
        has_version_change = name is not None or description is not None or content is not _UNSET

        if color is not _UNSET:
            track.color = str(color).strip() or None

        version_row: ObjectVersion | None = None
        if has_version_change:
            if not language:
                raise HTTPException(status_code=400, detail="language is required when updating track content")
            from .object_service import _normalize_rich_value
            current_data = {}
            current = latest_payload_with_fallback(db, TIMELINE_TRACK_TYPE, track.id, language)
            if current is not None:
                _latest, lang_row = current
                if lang_row is not None and isinstance(lang_row.data, dict):
                    current_data = dict(lang_row.data)
            version_row = _create_or_update_version(
                db,
                object_type=TIMELINE_TRACK_TYPE,
                object_id=track.id,
                language=language,
                new_data={
                    "name": str(name if name is not None else current_data.get("name") or ""),
                    "description": str(description if description is not None else current_data.get("description") or ""),
                    "content": _normalize_rich_value(content, rich_text_format=rich_text_format) if content is not _UNSET else current_data.get("content"),
                },
                user_request=user_request,
                created_by=user_id,
                create_new_version=create_new_version,
            )

        db.flush()

        deltas = []
        story_core_after = snapshot_story_core_row(track)
        deltas.append(build_story_core_delta(story_core_before, story_core_after))
        if has_version_change:
            deltas.append(
                build_object_version_delta(
                    object_type=TIMELINE_TRACK_TYPE,
                    before=version_before,
                    after=snapshot_object_version_row(version_row),
                )
            )
        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=project_id,
            deltas=deltas,
            enforce_quota=True,
        )

        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=TIMELINE_TRACK_TYPE,
            object_id=track.id,
            action="updated",
        )
        latest_map = (
            {track.id: _version_entry_for_parent(db, version_row, language=language)}
            if version_row is not None
            else _latest_versions_map(db, TIMELINE_TRACK_TYPE, [track.id], language=language)
        )
        return _serialize_track_tree(
            track,
            language=language,
            track_versions=latest_map,
            events_by_track_id={},
            event_versions={},
            links_by_event_id={},
            children_by_parent_id={},
        )

    def move_track(
        self,
        db: Session,
        *,
        project_id: UUID,
        track_id: UUID,
        parent_id: UUID | None,
        position: int | None,
        user_id: UUID,
        language: str | None = None,
    ) -> dict[str, Any]:
        track = _track_query(db, project_id).filter(TimelineTrack.id == track_id).first()
        if track is None:
            raise HTTPException(status_code=404, detail="Timeline track not found")
        _move_track(db, track=track, new_parent_id=parent_id, new_position=position)
        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=TIMELINE_TRACK_TYPE,
            object_id=track.id,
            action="updated",
        )
        latest_map = _latest_versions_map(db, TIMELINE_TRACK_TYPE, [track.id], language=language)
        return _serialize_track_tree(
            track,
            language=language,
            track_versions=latest_map,
            events_by_track_id={},
            event_versions={},
            links_by_event_id={},
            children_by_parent_id={},
        )

    def delete_track(
        self,
        db: Session,
        *,
        project_id: UUID,
        track_id: UUID,
        user_id: UUID,
    ) -> None:
        track = _track_query(db, project_id).filter(TimelineTrack.id == track_id).first()
        if track is None:
            raise HTTPException(status_code=404, detail="Timeline track not found")

        all_tracks = db.query(TimelineTrack).filter(TimelineTrack.timeline_id == track.timeline_id).all()
        track_ids = _collect_track_descendant_ids(all_tracks, root_id=track.id)
        event_ids = [
            event_id
            for event_id, in db.query(TimelineEvent.id).filter(TimelineEvent.track_id.in_(track_ids)).all()
            if isinstance(event_id, UUID)
        ]

        story_core_before = snapshot_rows(
            db.query(TimelineTrack).filter(TimelineTrack.id.in_(track_ids)).all(),
            snapshot_story_core_row,
        )
        story_core_before.extend(
            snapshot_rows(
                db.query(TimelineEvent).filter(TimelineEvent.id.in_(event_ids)).all(),
                snapshot_story_core_row,
            )
        )

        ids_by_type = {
            TIMELINE_TRACK_TYPE: track_ids,
            TIMELINE_EVENT_TYPE: event_ids,
        }
        version_before: list[object] = []
        for object_type, object_ids in ids_by_type.items():
            if not object_ids:
                continue
            version_before.extend(
                snapshot_rows(
                    db.query(ObjectVersion)
                    .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id.in_(object_ids))
                    .all(),
                    snapshot_object_version_row,
                )
            )

        former_parent_id = track.parent_id
        delete_semantic_sources_bulk(
            db,
            user_id=user_id,
            project_id=project_id,
            ids_by_type=ids_by_type,
        )
        delete_object_versions_bulk(db, ids_by_type=ids_by_type)
        db.query(TimelineTrack).filter(TimelineTrack.id.in_(track_ids)).delete(synchronize_session=False)
        db.flush()
        _normalize_track_positions(
            db,
            timeline_id=track.timeline_id,
            parent_id=former_parent_id,
        )

        for deleted_type, object_ids in ids_by_type.items():
            for object_id in object_ids:
                queue_object_change(
                    db,
                    user_id=user_id,
                    project_id=project_id,
                    object_type=deleted_type,
                    object_id=object_id,
                    action="deleted",
                )

        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=project_id,
            deltas=[
                build_story_core_rows_delta(story_core_before, []),
                build_usage_delta_for_measurement_rows(
                    category="story",
                    before_rows=version_before,
                    after_rows=[],
                    measure_fn=lambda row: measure_object_version_row(row),
                ),
            ],
            enforce_quota=False,
        )

    def create_event(
        self,
        db: Session,
        *,
        project_id: UUID,
        track_id: UUID,
        language: str,
        name: str,
        description: str,
        content: Any = None,
        rich_text_format: str = "tiptap",
        start_date: dict[str, Any],
        end_date: dict[str, Any] | None,
        tags: list[str] | None,
        user_request: str,
        user_id: UUID,
    ) -> dict[str, Any]:
        track = _track_query(db, project_id).filter(TimelineTrack.id == track_id).first()
        if track is None:
            raise HTTPException(status_code=404, detail="Timeline track not found")
        timeline = db.query(Timeline).filter(Timeline.id == track.timeline_id).first()
        if timeline is None:
            raise HTTPException(status_code=404, detail="Timeline not found")

        calendar = timeline.calendar if isinstance(timeline.calendar, dict) else default_calendar()
        _validate_event_dates(start_date=start_date, end_date=end_date, calendar=calendar)

        event = TimelineEvent(
            id=uuid4(),
            track_id=track.id,
            start_date=deepcopy(start_date),
            end_date=deepcopy(end_date) if isinstance(end_date, dict) else None,
            tags=_sanitize_tags(tags),
        )
        db.add(event)
        db.flush()

        version = _create_or_update_version(
            db,
            object_type=TIMELINE_EVENT_TYPE,
            object_id=event.id,
            language=language,
            new_data=_content_payload(name, description, content, rich_text_format=rich_text_format),
            user_request=user_request,
            created_by=user_id,
            create_new_version=True,
        )

        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=TIMELINE_EVENT_TYPE,
            object_id=event.id,
            action="created",
        )
        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=project_id,
            deltas=[
                build_story_core_delta(None, snapshot_story_core_row(event)),
                build_object_version_delta(
                    object_type=TIMELINE_EVENT_TYPE,
                    before=None,
                    after=snapshot_object_version_row(version),
                ),
            ],
            enforce_quota=True,
        )
        return _serialize_event(
            event,
            language=language,
            version_map={event.id: _version_entry_for_parent(db, version, language=language)},
            links_by_event_id={},
        )

    def update_event(
        self,
        db: Session,
        *,
        project_id: UUID,
        event_id: UUID,
        track_id: UUID | None,
        language: str | None,
        name: str | None,
        description: str | None,
        content: Any = _UNSET,
        rich_text_format: str = "tiptap",
        start_date: Any = _UNSET,
        end_date: Any = _UNSET,
        tags: Any = _UNSET,
        user_request: str,
        create_new_version: bool,
        user_id: UUID,
    ) -> dict[str, Any]:
        event = _event_query(db, project_id).filter(TimelineEvent.id == event_id).first()
        if event is None:
            raise HTTPException(status_code=404, detail="Timeline event not found")

        current_track = (
            db.query(TimelineTrack)
            .filter(TimelineTrack.id == event.track_id)
            .first()
        )
        if current_track is None:
            raise HTTPException(status_code=404, detail="Timeline track not found")

        target_track = current_track
        if track_id is not None and track_id != event.track_id:
            target_track = _track_query(db, project_id).filter(TimelineTrack.id == track_id).first()
            if target_track is None:
                raise HTTPException(status_code=404, detail="Target timeline track not found")
            event.track_id = target_track.id

        timeline = db.query(Timeline).filter(Timeline.id == target_track.timeline_id).first()
        if timeline is None:
            raise HTTPException(status_code=404, detail="Timeline not found")

        story_core_before = snapshot_story_core_row(event)
        version_before = snapshot_object_version_row(_latest_version(db, TIMELINE_EVENT_TYPE, event.id))
        has_version_change = name is not None or description is not None or content is not _UNSET

        if start_date is not _UNSET:
            event.start_date = deepcopy(start_date)
        if end_date is not _UNSET:
            event.end_date = deepcopy(end_date) if isinstance(end_date, dict) else None
        if tags is not _UNSET:
            event.tags = _sanitize_tags(tags)

        _validate_event_dates(
            start_date=event.start_date if isinstance(event.start_date, dict) else {},
            end_date=event.end_date if isinstance(event.end_date, dict) else None,
            calendar=timeline.calendar if isinstance(timeline.calendar, dict) else default_calendar(),
        )

        version_row: ObjectVersion | None = None
        if has_version_change:
            if not language:
                raise HTTPException(status_code=400, detail="language is required when updating event content")
            from .object_service import _normalize_rich_value
            current_data = {}
            current = latest_payload_with_fallback(db, TIMELINE_EVENT_TYPE, event.id, language)
            if current is not None:
                _latest, lang_row = current
                if lang_row is not None and isinstance(lang_row.data, dict):
                    current_data = dict(lang_row.data)
            version_row = _create_or_update_version(
                db,
                object_type=TIMELINE_EVENT_TYPE,
                object_id=event.id,
                language=language,
                new_data={
                    "name": str(name if name is not None else current_data.get("name") or ""),
                    "description": str(description if description is not None else current_data.get("description") or ""),
                    "content": _normalize_rich_value(content, rich_text_format=rich_text_format) if content is not _UNSET else current_data.get("content"),
                },
                user_request=user_request,
                created_by=user_id,
                create_new_version=create_new_version,
            )

        db.flush()

        deltas = [build_story_core_delta(story_core_before, snapshot_story_core_row(event))]
        if has_version_change:
            deltas.append(
                build_object_version_delta(
                    object_type=TIMELINE_EVENT_TYPE,
                    before=version_before,
                    after=snapshot_object_version_row(version_row),
                )
            )
        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=project_id,
            deltas=deltas,
            enforce_quota=True,
        )

        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=TIMELINE_EVENT_TYPE,
            object_id=event.id,
            action="updated",
        )
        latest_map = (
            {event.id: _version_entry_for_parent(db, version_row, language=language)}
            if version_row is not None
            else _latest_versions_map(db, TIMELINE_EVENT_TYPE, [event.id], language=language)
        )
        return _serialize_event(
            event,
            language=language,
            version_map=latest_map,
            links_by_event_id={event.id: list(event.links)},
        )

    def delete_event(
        self,
        db: Session,
        *,
        project_id: UUID,
        event_id: UUID,
        user_id: UUID,
    ) -> None:
        event = _event_query(db, project_id).filter(TimelineEvent.id == event_id).first()
        if event is None:
            raise HTTPException(status_code=404, detail="Timeline event not found")

        story_core_before = snapshot_rows([event], snapshot_story_core_row)
        version_before = snapshot_rows(
            db.query(ObjectVersion)
            .filter(ObjectVersion.object_type == TIMELINE_EVENT_TYPE, ObjectVersion.object_id == event.id)
            .all(),
            snapshot_object_version_row,
        )
        delete_semantic_sources_bulk(
            db,
            user_id=user_id,
            project_id=project_id,
            ids_by_type={TIMELINE_EVENT_TYPE: [event.id]},
        )
        delete_object_versions_bulk(db, ids_by_type={TIMELINE_EVENT_TYPE: [event.id]})
        db.query(TimelineEvent).filter(TimelineEvent.id == event_id).delete(synchronize_session=False)
        db.flush()

        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=TIMELINE_EVENT_TYPE,
            object_id=event_id,
            action="deleted",
        )
        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=project_id,
            deltas=[
                build_story_core_rows_delta(story_core_before, []),
                build_usage_delta_for_measurement_rows(
                    category="story",
                    before_rows=version_before,
                    after_rows=[],
                    measure_fn=lambda row: measure_object_version_row(row),
                ),
            ],
            enforce_quota=False,
        )

    def link_event(
        self,
        db: Session,
        *,
        project_id: UUID,
        event_id: UUID,
        object_type: str,
        object_id: UUID,
        user_id: UUID,
    ) -> dict[str, Any]:
        if object_type not in ALLOWED_LINK_TYPES:
            raise HTTPException(status_code=400, detail=f"Cannot link to object type: {object_type}")

        event = _event_query(db, project_id).filter(TimelineEvent.id == event_id).first()
        if event is None:
            raise HTTPException(status_code=404, detail="Timeline event not found")

        linked_project_id = resolve_project_id_for_object(
            db,
            object_type=object_type,
            object_id=object_id,
            user_id=user_id,
        )
        if linked_project_id != project_id:
            raise HTTPException(status_code=400, detail="Cannot link objects across projects")

        existing = (
            db.query(TimelineEventLink)
            .filter(
                TimelineEventLink.event_id == event.id,
                TimelineEventLink.object_type == object_type,
                TimelineEventLink.object_id == object_id,
            )
            .first()
        )
        if existing is not None:
            return _serialize_link(existing)

        link = TimelineEventLink(
            id=uuid4(),
            event_id=event.id,
            object_type=object_type,
            object_id=object_id,
        )
        db.add(link)
        db.flush()
        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=TIMELINE_EVENT_TYPE,
            object_id=event.id,
            action="updated",
        )
        return _serialize_link(link)

    def unlink_event(
        self,
        db: Session,
        *,
        project_id: UUID,
        event_id: UUID,
        link_id: UUID,
        user_id: UUID,
    ) -> None:
        event = _event_query(db, project_id).filter(TimelineEvent.id == event_id).first()
        if event is None:
            raise HTTPException(status_code=404, detail="Timeline event not found")
        link = (
            db.query(TimelineEventLink)
            .filter(TimelineEventLink.id == link_id, TimelineEventLink.event_id == event.id)
            .first()
        )
        if link is None:
            raise HTTPException(status_code=404, detail="Timeline event link not found")
        db.delete(link)
        db.flush()
        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=TIMELINE_EVENT_TYPE,
            object_id=event.id,
            action="updated",
        )

    def list_links_by_object(
        self,
        db: Session,
        *,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
    ) -> list[dict[str, Any]]:
        links = (
            _event_link_query(db, project_id)
            .filter(TimelineEventLink.object_type == object_type, TimelineEventLink.object_id == object_id)
            .order_by(TimelineEventLink.created_at.asc(), TimelineEventLink.id.asc())
            .all()
        )
        return [_serialize_link(link) for link in links]


timeline_service = TimelineService()

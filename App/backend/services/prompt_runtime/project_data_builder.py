from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import (
    BasicInfo,
    Guidelines,
    Manuscript,
    Outline,
    StoryEntity,
    Timeline,
    TimelineEvent,
    TimelineTrack,
)
from ...models.translation_models import ObjectVersion
from ...utils.timeline_calendar import default_calendar, format_date
from ...utils.story_entities import STORY_ENTITY_TYPE
from ..basic_info_utils import basic_info_summary_text, normalize_basic_info_data
from ..sidecar_client import SidecarClient
from ..story_entity_tree_service import (
    build_story_entity_folder_content_map,
    build_story_entity_folder_path_map,
    list_story_entity_folders,
)


def _latest_version_data(db: Session, object_type: str, object_id: UUID) -> dict[str, Any]:
    row = (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )
    if row is None or not isinstance(row.data, dict):
        return {}
    return row.data


def _lang_data(all_data: dict[str, Any], language: str) -> dict[str, Any]:
    if isinstance(all_data.get(language), dict):
        return dict(all_data[language])
    for value in all_data.values():
        if isinstance(value, dict):
            return dict(value)
    return {}


def _resolve_manuscript_lang_data(
    all_data: dict[str, Any],
    language: str,
) -> dict[str, Any]:
    requested_entry = all_data.get(language)
    if isinstance(requested_entry, dict) and isinstance(requested_entry.get("doc"), dict):
        return dict(requested_entry)

    for candidate_language, value in all_data.items():
        if candidate_language == language or not isinstance(value, dict):
            continue
        if not isinstance(value.get("doc"), dict):
            continue
        return dict(value)

    if isinstance(requested_entry, dict):
        return dict(requested_entry)
    return {}


def _story_entity_payload(
    row: StoryEntity,
    *,
    lang_data: dict[str, Any],
    folder_path: list[str],
) -> dict[str, Any]:
    return {
        "type": STORY_ENTITY_TYPE,
        "kind": str(row.kind),
        "id": str(row.id),
        "name": str(lang_data.get("name") or ""),
        "description": str(lang_data.get("description") or ""),
        "content": str(lang_data.get("content") or ""),
        "folderId": str(row.folder_id) if row.folder_id else None,
        "folderPath": list(folder_path),
        "displayOrder": int(row.display_order or 0),
        "imagePrompt": getattr(row, "image_prompt", None),
        "imagePromptPositive": getattr(row, "image_prompt_positive", None),
        "imagePromptNegative": getattr(row, "image_prompt_negative", None),
    }


def _story_entity_sort_key(display_order: Any, *, is_folder: bool, node_id: UUID) -> tuple[int, int, str]:
    return (int(display_order or 0), 0 if is_folder else 1, str(node_id))


def _build_story_entity_tree(
    *,
    folders: list[Any],
    folder_content_map: dict[UUID, dict[str, Any]],
    entities: list[StoryEntity],
    entity_payloads: dict[UUID, dict[str, Any]],
) -> list[dict[str, Any]]:
    folders_by_parent: dict[UUID | None, list[Any]] = {}
    for folder in folders:
        folders_by_parent.setdefault(folder.parent_id, []).append(folder)
    for values in folders_by_parent.values():
        values.sort(key=lambda row: _story_entity_sort_key(row.display_order, is_folder=True, node_id=row.id))

    entities_by_parent: dict[UUID | None, list[StoryEntity]] = {}
    for entity in entities:
        entities_by_parent.setdefault(entity.folder_id, []).append(entity)
    for values in entities_by_parent.values():
        values.sort(key=lambda row: _story_entity_sort_key(row.display_order, is_folder=False, node_id=row.id))

    def _walk(parent_id: UUID | None) -> list[dict[str, Any]]:
        folder_rows = folders_by_parent.get(parent_id, [])
        entity_rows = entities_by_parent.get(parent_id, [])
        nodes: list[tuple[int, int, Any]] = []
        for folder in folder_rows:
            nodes.append((int(folder.display_order or 0), 0, folder))
        for entity in entity_rows:
            nodes.append((int(entity.display_order or 0), 1, entity))
        nodes.sort(key=lambda item: (item[0], item[1], str(item[2].id)))

        children: list[dict[str, Any]] = []
        for _display_order, kind_weight, row in nodes:
            if kind_weight == 0:
                children.append(
                    {
                        "nodeType": "folder",
                        "id": str(row.id),
                        "name": str(folder_content_map.get(row.id, {}).get("name") or ""),
                        "description": str(folder_content_map.get(row.id, {}).get("description") or ""),
                        "children": _walk(row.id),
                    }
                )
                continue

            payload = entity_payloads.get(row.id)
            if payload is None:
                continue
            children.append(
                {
                    "nodeType": STORY_ENTITY_TYPE,
                    "entity": payload,
                }
            )
        return children

    return _walk(None)


def _flatten_story_entity_tree(tree: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered: list[dict[str, Any]] = []

    def _walk(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if str(node.get("nodeType") or "") == "folder":
                children = node.get("children")
                if isinstance(children, list):
                    _walk(children)
                continue
            entity = node.get("entity")
            if isinstance(entity, dict):
                ordered.append(entity)

    _walk(tree)
    return ordered


def _outline_sort_key(row: Outline) -> tuple[int, Any, str]:
    return (int(row.position or 0), row.created_at, str(row.id))


def _build_outline_numbering(outlines: list[Outline]) -> dict[UUID, dict[str, int | None]]:
    """Compute canonical act/chapter numbers per root outline.

    Numbers are structural metadata derived from the full outline tree, not from
    whatever subset might later be rendered into prompt context.
    """
    children_by_parent: dict[UUID | None, list[Outline]] = {}
    for row in outlines:
        children_by_parent.setdefault(row.parent_id, []).append(row)
    for values in children_by_parent.values():
        values.sort(key=_outline_sort_key)

    numbering: dict[UUID, dict[str, int | None]] = {}
    for root in children_by_parent.get(None, []):
        if str(root.kind or "") != "outline":
            continue

        act_number = 0
        chapter_number = 0
        for act in children_by_parent.get(root.id, []):
            if str(act.kind or "") != "act":
                continue

            act_number += 1
            numbering[act.id] = {"actNumber": act_number, "chapterNumber": None}

            for chapter in children_by_parent.get(act.id, []):
                if str(chapter.kind or "") != "chapter":
                    continue

                chapter_number += 1
                numbering[chapter.id] = {
                    "actNumber": act_number,
                    "chapterNumber": chapter_number,
                }

    return numbering


def _timeline_date_range_text(
    *,
    start_date: dict[str, Any] | None,
    end_date: dict[str, Any] | None,
    calendar: dict[str, Any],
) -> str:
    if not isinstance(start_date, dict):
        return ""
    start_text = format_date(start_date, calendar)
    if not isinstance(end_date, dict) or end_date == start_date:
        return start_text
    return f"{start_text} -> {format_date(end_date, calendar)}"


def _build_timeline_payload(
    *,
    timeline: Timeline | None,
    tracks: list[TimelineTrack],
    events: list[TimelineEvent],
    get_latest: Any,
    language: str,
) -> dict[str, Any]:
    if timeline is None:
        return {
            "id": "",
            "projectId": "",
            "calendar": default_calendar(),
            "tracks": [],
            "events": [],
        }

    calendar = timeline.calendar if isinstance(timeline.calendar, dict) else default_calendar()
    track_lang_data = {
        track.id: _lang_data(get_latest("timeline_track", track.id), language)
        for track in tracks
    }
    event_lang_data = {
        event.id: _lang_data(get_latest("timeline_event", event.id), language)
        for event in events
    }

    children_by_parent: dict[UUID | None, list[TimelineTrack]] = {}
    for track in tracks:
        children_by_parent.setdefault(track.parent_id, []).append(track)
    for values in children_by_parent.values():
        values.sort(key=lambda row: (int(row.position or 0), row.created_at, str(row.id)))

    events_by_track_id: dict[UUID, list[TimelineEvent]] = {}
    for event in events:
        events_by_track_id.setdefault(event.track_id, []).append(event)
    for values in events_by_track_id.values():
        values.sort(key=lambda row: (row.created_at, str(row.id)))

    def event_payload(event: TimelineEvent) -> dict[str, Any]:
        lang_data = event_lang_data.get(event.id, {})
        track_data = track_lang_data.get(event.track_id, {})
        return {
            "id": str(event.id),
            "trackId": str(event.track_id),
            "trackName": str(track_data.get("name") or ""),
            "name": str(lang_data.get("name") or ""),
            "description": str(lang_data.get("description") or ""),
            "startDate": dict(event.start_date) if isinstance(event.start_date, dict) else {},
            "endDate": dict(event.end_date) if isinstance(event.end_date, dict) else None,
            "tags": list(event.tags) if isinstance(event.tags, list) else [],
            "formattedDate": _timeline_date_range_text(
                start_date=event.start_date if isinstance(event.start_date, dict) else None,
                end_date=event.end_date if isinstance(event.end_date, dict) else None,
                calendar=calendar,
            ),
        }

    def build_track_tree(parent_id: UUID | None) -> list[dict[str, Any]]:
        payload: list[dict[str, Any]] = []
        for track in children_by_parent.get(parent_id, []):
            lang_data = track_lang_data.get(track.id, {})
            payload.append(
                {
                    "id": str(track.id),
                    "parentId": str(track.parent_id) if track.parent_id else None,
                    "position": int(track.position or 0),
                    "color": track.color,
                    "name": str(lang_data.get("name") or ""),
                    "description": str(lang_data.get("description") or ""),
                    "events": [event_payload(event) for event in events_by_track_id.get(track.id, [])],
                    "children": build_track_tree(track.id),
                }
            )
        return payload

    return {
        "id": str(timeline.id),
        "projectId": str(timeline.project_id),
        "calendar": calendar,
        "tracks": build_track_tree(None),
        "events": [event_payload(event) for event in events],
    }


async def build_project_data(
    db: Session,
    project_id: UUID,
    language: str,
    sidecar_client: SidecarClient,
) -> dict[str, Any]:
    basic = db.query(BasicInfo).filter(BasicInfo.project_id == project_id).first()
    guidelines = db.query(Guidelines).filter(Guidelines.project_id == project_id).first()
    story_entities = (
        db.query(StoryEntity)
        .filter(StoryEntity.project_id == project_id)
        .order_by(StoryEntity.display_order.asc())
        .all()
    )
    story_entity_folders = list_story_entity_folders(db, project_id=project_id)

    outlines = (
        db.query(Outline)
        .filter(Outline.project_id == project_id)
        .order_by(Outline.position.asc(), Outline.created_at.asc(), Outline.id.asc())
        .all()
    )
    manuscripts = (
        db.query(Manuscript)
        .join(Outline, Outline.id == Manuscript.chapter_id)
        .filter(Outline.project_id == project_id, Outline.kind == "chapter")
        .all()
    )
    try:
        timeline = db.query(Timeline).filter(Timeline.project_id == project_id).first()
        timeline_tracks = (
            db.query(TimelineTrack)
            .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
            .filter(Timeline.project_id == project_id)
            .order_by(TimelineTrack.position.asc(), TimelineTrack.created_at.asc(), TimelineTrack.id.asc())
            .all()
        )
        timeline_events = (
            db.query(TimelineEvent)
            .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
            .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
            .filter(Timeline.project_id == project_id)
            .order_by(TimelineEvent.created_at.asc(), TimelineEvent.id.asc())
            .all()
        )
    except AssertionError:
        timeline = None
        timeline_tracks = []
        timeline_events = []

    latest: dict[tuple[str, UUID], dict[str, Any]] = {}

    def get_latest(object_type: str, object_id: UUID) -> dict[str, Any]:
        key = (object_type, object_id)
        if key not in latest:
            latest[key] = _latest_version_data(db, object_type, object_id)
        return latest[key]

    all_languages: set[str] = {language}
    for object_type, rows in [
        ("basic_info", [basic] if basic is not None else []),
        ("guidelines", [guidelines] if guidelines is not None else []),
        (STORY_ENTITY_TYPE, story_entities),
        ("outline", outlines),
        ("manuscript", manuscripts),
        ("timeline_track", timeline_tracks),
        ("timeline_event", timeline_events),
    ]:
        for row in rows:
            all_languages.update(get_latest(object_type, row.id).keys())

    def _basic_info_payload(lang: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
        if basic is None:
            return {"id": "", "title": "", "logline": "", "genres": [], "tags": []}, None
        payload = normalize_basic_info_data(_lang_data(get_latest("basic_info", basic.id), lang))
        return (
            {"id": str(basic.id), **payload},
            {
                "type": "basic_info",
                "id": str(basic.id),
                "name": str(payload.get("title") or ""),
                "description": str(payload.get("logline") or ""),
                "content": basic_info_summary_text(payload),
                "imagePrompt": getattr(basic, "image_prompt", None),
                "imagePromptPositive": getattr(basic, "image_prompt_positive", None),
                "imagePromptNegative": getattr(basic, "image_prompt_negative", None),
            },
        )

    def _guidelines_payload(lang: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
        if guidelines is None:
            return {"id": "", "authorNote": ""}, None
        guideline_data = _lang_data(get_latest("guidelines", guidelines.id), lang)
        payload = {
            "id": str(guidelines.id),
            "authorNote": str(guideline_data.get("authorNote") or ""),
        }
        return (
            payload,
            {
                "type": "guidelines",
                "id": str(guidelines.id),
                "name": "Guidelines",
                "description": "",
                "content": str(guideline_data.get("authorNote") or ""),
            },
        )

    basic_info, basic_context_object = _basic_info_payload(language)
    guideline_payload, guideline_context_object = _guidelines_payload(language)

    def build_story_entities_payload(lang: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        folder_path_map = build_story_entity_folder_path_map(
            db,
            project_id=project_id,
            language=lang,
            fallback_language=language,
        )
        folder_content_map = build_story_entity_folder_content_map(
            db,
            project_id=project_id,
            language=lang,
            fallback_language=language,
        )
        payload_map: dict[UUID, dict[str, Any]] = {}
        for row in story_entities:
            payload_map[row.id] = _story_entity_payload(
                row,
                lang_data=_lang_data(get_latest(STORY_ENTITY_TYPE, row.id), lang),
                folder_path=folder_path_map.get(row.folder_id, []) if row.folder_id else [],
            )
        story_entity_tree = _build_story_entity_tree(
            folders=story_entity_folders,
            folder_content_map=folder_content_map,
            entities=story_entities,
            entity_payloads=payload_map,
        )
        return _flatten_story_entity_tree(story_entity_tree), story_entity_tree

    outlines_by_id: dict[UUID, Outline] = {row.id: row for row in outlines}
    manuscript_by_chapter: dict[UUID, Manuscript] = {ms.chapter_id: ms for ms in manuscripts}
    outline_numbering = _build_outline_numbering(outlines)

    def build_outline_payload(lang: str) -> dict[str, Any]:
        children_by_parent: dict[UUID | None, list[Outline]] = {}
        for row in outlines:
            children_by_parent.setdefault(row.parent_id, []).append(row)
        for values in children_by_parent.values():
            values.sort(key=_outline_sort_key)

        def outline_node_payload(row: Outline) -> dict[str, Any]:
            outline_data = _lang_data(get_latest("outline", row.id), lang)
            manuscript = manuscript_by_chapter.get(row.id)
            numbering = outline_numbering.get(row.id, {})
            payload = {
                "id": str(row.id),
                "kind": str(row.kind or ""),
                "parentId": str(row.parent_id) if row.parent_id else None,
                "position": int(row.position or 0),
                "name": str(outline_data.get("name") or ""),
                "description": str(outline_data.get("description") or ""),
                "content": str(outline_data.get("content") or ""),
                "manuscriptId": str(manuscript.id) if manuscript is not None else None,
                "actNumber": numbering.get("actNumber"),
                "chapterNumber": numbering.get("chapterNumber"),
            }
            return payload

        def build_tree(parent_id: UUID | None) -> list[dict[str, Any]]:
            nodes: list[dict[str, Any]] = []
            for row in children_by_parent.get(parent_id, []):
                node = outline_node_payload(row)
                node["children"] = build_tree(row.id)
                nodes.append(node)
            return nodes

        flat_nodes = [outline_node_payload(row) for row in outlines]
        return {
            "nodes": flat_nodes,
            "tree": build_tree(None),
        }

    def outline_sort_path(row: Outline | None) -> tuple[int, int, int]:
        if row is None:
            return (10_000, 10_000, 10_000)
        if row.kind == "outline":
            return (int(row.position or 0), 10_000, 10_000)
        if row.kind == "act":
            parent = outlines_by_id.get(row.parent_id) if row.parent_id else None
            return (int(parent.position or 0) if parent else 10_000, int(row.position or 0), 10_000)
        parent = outlines_by_id.get(row.parent_id) if row.parent_id else None
        grandparent = outlines_by_id.get(parent.parent_id) if parent and parent.parent_id else None
        return (
            int(grandparent.position or 0) if grandparent else 10_000,
            int(parent.position or 0) if parent else 10_000,
            int(row.position or 0),
        )

    # Pre-convert manuscript docs to markdown per requested language.
    markdown_cache: dict[tuple[UUID, str], str] = {}
    manuscript_lang_cache: dict[tuple[UUID, str], dict[str, Any]] = {}

    async def _convert_manuscript_doc(manuscript: Manuscript, lang: str) -> None:
        key = (manuscript.id, lang)
        manuscript_versions = get_latest("manuscript", manuscript.id)
        manuscript_data = _resolve_manuscript_lang_data(
            manuscript_versions,
            lang,
        )
        manuscript_lang_cache[key] = manuscript_data
        doc = manuscript_data.get("doc") if isinstance(manuscript_data.get("doc"), dict) else None
        if doc is not None:
            markdown_cache[key] = await sidecar_client.doc_to_markdown(doc)
        else:
            markdown_cache[key] = ""

    if manuscripts:
        await asyncio.gather(
            *[
                _convert_manuscript_doc(ms, lang)
                for ms in manuscripts
                for lang in all_languages
            ]
        )

    def build_manuscripts_payload(lang: str) -> list[dict[str, Any]]:
        sorted_manuscripts = sorted(
            manuscripts,
            key=lambda ms: outline_sort_path(outlines_by_id.get(ms.chapter_id)),
        )
        payload: list[dict[str, Any]] = []
        for manuscript in sorted_manuscripts:
            manuscript_key = (manuscript.id, lang)
            manuscript_data = dict(
                manuscript_lang_cache.get(manuscript_key)
                or _resolve_manuscript_lang_data(
                    get_latest("manuscript", manuscript.id),
                    lang,
                )
            )
            chapter = outlines_by_id.get(manuscript.chapter_id)
            chapter_data = _lang_data(get_latest("outline", chapter.id), lang) if chapter is not None else {}
            numbering = outline_numbering.get(chapter.id, {}) if chapter is not None else {}

            markdown = markdown_cache.get(manuscript_key, "")

            payload.append(
                {
                    "id": str(manuscript.id),
                    "chapterId": str(manuscript.chapter_id),
                    "chapterName": str(chapter_data.get("name") or ""),
                    "actNumber": numbering.get("actNumber"),
                    "chapterNumber": numbering.get("chapterNumber"),
                    "content": markdown,
                    "wordCount": int(manuscript_data.get("wordCount") or len(markdown.split())),
                }
            )
        return payload

    story_entities_payload, story_entity_tree_payload = build_story_entities_payload(language)
    outline_payload = build_outline_payload(language)
    manuscripts_payload = build_manuscripts_payload(language)
    timeline_payload = _build_timeline_payload(
        timeline=timeline,
        tracks=timeline_tracks,
        events=timeline_events,
        get_latest=get_latest,
        language=language,
    )

    content_by_lang: dict[str, Any] = {}
    for lang in sorted(all_languages):
        lang_basic_info, _ = _basic_info_payload(lang)
        lang_guidelines, _ = _guidelines_payload(lang)

        lang_story_entities, lang_story_entity_tree = build_story_entities_payload(lang)
        content_by_lang[lang] = {
            "basicInfo": lang_basic_info,
            "guidelines": lang_guidelines,
            "storyEntities": lang_story_entities,
            "storyEntityTree": lang_story_entity_tree,
            "outline": build_outline_payload(lang),
            "manuscripts": build_manuscripts_payload(lang),
            "timeline": _build_timeline_payload(
                timeline=timeline,
                tracks=timeline_tracks,
                events=timeline_events,
                get_latest=get_latest,
                language=lang,
            ),
        }

    return {
        "basicInfo": basic_info,
        "guidelines": guideline_payload,
        "storyEntities": story_entities_payload,
        "storyEntityTree": story_entity_tree_payload,
        "outline": outline_payload,
        "manuscripts": manuscripts_payload,
        "timeline": timeline_payload,
        "contentByLang": content_by_lang,
    }

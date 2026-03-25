from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import make_result, valid_result
from ....models.db_models import BasicInfo, Manuscript, Outline, StoryEntity, Timeline, TimelineEvent, TimelineTrack
from ....models.translation_models import ObjectVersion
from ....utils.story_entities import STORY_ENTITY_TYPE
from ...story_entity_tree_service import (
    build_story_entity_folder_content_map,
    list_story_entity_folders,
)
from .shared import filter_allowed_specs, is_non_journey, obj_schema


def _latest_names(
    db: Session,
    object_type: str,
    object_ids: list[UUID],
    language: str,
) -> dict[UUID, str]:
    if not object_ids:
        return {}
    rows = (
        db.query(ObjectVersion)
        .filter(
            ObjectVersion.object_type == object_type,
            ObjectVersion.object_id.in_(object_ids),
        )
        .order_by(ObjectVersion.object_id, ObjectVersion.version_number.desc())
        .all()
    )
    result: dict[UUID, str] = {}
    for row in rows:
        if row.object_id in result:
            continue
        data = row.data if isinstance(row.data, dict) else {}
        lang_data = data.get(language)
        if not isinstance(lang_data, dict):
            for v in data.values():
                if isinstance(v, dict):
                    lang_data = v
                    break
        result[row.object_id] = str((lang_data or {}).get("name") or "")
    return result


def _build_outline_numbering(outlines: list[Outline]) -> dict[UUID, dict[str, int | None]]:
    children_by_parent: dict[UUID | None, list[Outline]] = {}
    for row in outlines:
        children_by_parent.setdefault(row.parent_id, []).append(row)
    for values in children_by_parent.values():
        values.sort(key=lambda r: (int(r.position or 0), r.created_at, str(r.id)))

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
                numbering[chapter.id] = {"actNumber": act_number, "chapterNumber": chapter_number}

    return numbering


@tool_call_module(prefix="get_")
class TreeToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("read",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not is_non_journey(ctx):
            return []
        return filter_allowed_specs(
            ctx,
            [
                ToolSpec(
                    name="get_project_tree",
                    description="Get a lightweight tree overview of the project structure (title, story entities, outline hierarchy). Returns names and IDs only, not full content.",
                    parameters=obj_schema({}, []),
                    auto_approve_category="read",
                ),
            ],
        )

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext) -> Any:
        return valid_result()

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        db = ctx.db
        project_id = ctx.project_id
        language = ctx.language

        # --- Title ---
        title = ""
        basic = db.query(BasicInfo).filter(BasicInfo.project_id == project_id).first()
        if basic is not None:
            names = _latest_names(db, "basic_info", [basic.id], language)
            title = names.get(basic.id, "")
            if not title:
                ver = (
                    db.query(ObjectVersion)
                    .filter(ObjectVersion.object_type == "basic_info", ObjectVersion.object_id == basic.id)
                    .order_by(ObjectVersion.version_number.desc())
                    .first()
                )
                if ver and isinstance(ver.data, dict):
                    lang_data = ver.data.get(language)
                    if not isinstance(lang_data, dict):
                        for v in ver.data.values():
                            if isinstance(v, dict):
                                lang_data = v
                                break
                    if isinstance(lang_data, dict):
                        title = str(lang_data.get("title") or lang_data.get("name") or "")

        # --- Story entity tree ---
        story_entity_folders = list_story_entity_folders(db, project_id=project_id)
        folder_content_map = build_story_entity_folder_content_map(
            db, project_id=project_id, language=language, fallback_language=language,
        )
        story_entities = (
            db.query(StoryEntity)
            .filter(StoryEntity.project_id == project_id)
            .order_by(StoryEntity.display_order.asc())
            .all()
        )
        entity_names = _latest_names(db, STORY_ENTITY_TYPE, [e.id for e in story_entities], language)

        def _sort_key(display_order: int, is_folder: bool, node_id: UUID) -> tuple[int, int, str]:
            return (display_order, 0 if is_folder else 1, str(node_id))

        folders_by_parent: dict[UUID | None, list[Any]] = {}
        for folder in story_entity_folders:
            folders_by_parent.setdefault(folder.parent_id, []).append(folder)

        entities_by_parent: dict[UUID | None, list[StoryEntity]] = {}
        for entity in story_entities:
            entities_by_parent.setdefault(entity.folder_id, []).append(entity)

        def _walk_entities(parent_id: UUID | None) -> list[dict[str, Any]]:
            folder_rows = folders_by_parent.get(parent_id, [])
            entity_rows = entities_by_parent.get(parent_id, [])
            nodes: list[tuple[tuple[int, int, str], int, Any]] = []
            for f in folder_rows:
                nodes.append((_sort_key(int(f.display_order or 0), True, f.id), 0, f))
            for e in entity_rows:
                nodes.append((_sort_key(int(e.display_order or 0), False, e.id), 1, e))
            nodes.sort(key=lambda x: x[0])

            children: list[dict[str, Any]] = []
            for _key, kind_weight, row in nodes:
                if kind_weight == 0:
                    children.append({
                        "nodeType": "folder",
                        "id": str(row.id),
                        "name": str(folder_content_map.get(row.id, {}).get("name") or ""),
                        "children": _walk_entities(row.id),
                    })
                else:
                    children.append({
                        "nodeType": "entity",
                        "id": str(row.id),
                        "name": entity_names.get(row.id, ""),
                        "kind": str(row.kind),
                    })
            return children

        story_entity_tree = _walk_entities(None)

        # --- Outline tree ---
        outlines = (
            db.query(Outline)
            .filter(Outline.project_id == project_id)
            .order_by(Outline.position.asc(), Outline.created_at.asc(), Outline.id.asc())
            .all()
        )
        outline_names = _latest_names(db, "outline", [o.id for o in outlines], language)
        numbering = _build_outline_numbering(outlines)

        manuscript_map: dict[UUID, UUID] = {}
        ms_rows = (
            db.query(Manuscript.chapter_id, Manuscript.id)
            .join(Outline, Outline.id == Manuscript.chapter_id)
            .filter(Outline.project_id == project_id)
            .all()
        )
        for chapter_id, ms_id in ms_rows:
            manuscript_map[chapter_id] = ms_id

        outline_children: dict[UUID | None, list[Outline]] = {}
        for row in outlines:
            outline_children.setdefault(row.parent_id, []).append(row)
        for values in outline_children.values():
            values.sort(key=lambda r: (int(r.position or 0), r.created_at, str(r.id)))

        def _walk_outline(parent_id: UUID | None) -> list[dict[str, Any]]:
            nodes: list[dict[str, Any]] = []
            for row in outline_children.get(parent_id, []):
                num = numbering.get(row.id, {})
                node: dict[str, Any] = {
                    "id": str(row.id),
                    "kind": str(row.kind or ""),
                    "name": outline_names.get(row.id, ""),
                }
                if num.get("actNumber") is not None:
                    node["actNumber"] = num["actNumber"]
                if num.get("chapterNumber") is not None:
                    node["chapterNumber"] = num["chapterNumber"]
                if str(row.kind or "") == "chapter":
                    ms_id = manuscript_map.get(row.id)
                    node["manuscriptId"] = str(ms_id) if ms_id else None
                children = _walk_outline(row.id)
                if children:
                    node["children"] = children
                nodes.append(node)
            return nodes

        outline_tree = _walk_outline(None)

        # --- Timeline tree ---
        timeline_summary: dict[str, Any] = {"tracks": []}
        timeline = db.query(Timeline).filter(Timeline.project_id == project_id).first()
        if timeline is not None:
            timeline_tracks = (
                db.query(TimelineTrack)
                .filter(TimelineTrack.timeline_id == timeline.id)
                .order_by(TimelineTrack.position.asc(), TimelineTrack.created_at.asc(), TimelineTrack.id.asc())
                .all()
            )
            track_names = _latest_names(db, "timeline_track", [track.id for track in timeline_tracks], language)
            event_count_rows = (
                db.query(TimelineEvent.track_id, TimelineEvent.id)
                .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
                .filter(TimelineTrack.timeline_id == timeline.id)
                .all()
            )
            event_count_by_track_id: dict[UUID, int] = {}
            for track_id, _event_id in event_count_rows:
                event_count_by_track_id[track_id] = event_count_by_track_id.get(track_id, 0) + 1

            children_by_parent: dict[UUID | None, list[TimelineTrack]] = {}
            for row in timeline_tracks:
                children_by_parent.setdefault(row.parent_id, []).append(row)
            for values in children_by_parent.values():
                values.sort(key=lambda r: (int(r.position or 0), r.created_at, str(r.id)))

            def _walk_timeline(parent_id: UUID | None) -> list[dict[str, Any]]:
                return [
                    {
                        "id": str(row.id),
                        "name": track_names.get(row.id, ""),
                        "eventCount": int(event_count_by_track_id.get(row.id, 0)),
                        "position": int(row.position or 0),
                        "children": _walk_timeline(row.id),
                    }
                    for row in children_by_parent.get(parent_id, [])
                ]

            timeline_summary = {"tracks": _walk_timeline(None)}

        return make_result(
            "Project tree retrieved",
            data={
                "tree": {
                    "title": title,
                    "storyEntities": story_entity_tree,
                    "outline": outline_tree,
                    "timeline": timeline_summary,
                },
            },
        )

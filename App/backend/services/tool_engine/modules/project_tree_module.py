from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ....models.db_models import BasicInfo, Manuscript, Outline, StoryEntity, Timeline, TimelineEvent, TimelineTrack
from ....models.translation_models import ObjectVersion
from ....utils.story_entities import STORY_ENTITY_TYPE
from ...story_entity_tree_service import build_story_entity_folder_content_map, list_story_entity_folders
from ..contracts import PersistedToolMeta, ToolBinding, ToolBindingMeta, ToolExecutionOutcome, ToolFeatureModule, ToolSpec
from ..registry import tool_feature_module
from ..result_utils import make_result, valid_result
from .feature_common import filter_allowed_bindings
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
            for value in data.values():
                if isinstance(value, dict):
                    lang_data = value
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


def _project_tree_spec(ctx) -> ToolSpec | None:
    if not is_non_journey(ctx):
        return None
    specs = filter_allowed_specs(
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
    return specs[0] if specs else None


@tool_feature_module()
class ProjectTreeFeatureModule(ToolFeatureModule):
    feature_key = "project_tree"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        spec = _project_tree_spec(ctx)
        if spec is None:
            return []

        async def _validate(_args, _validation_ctx):
            return valid_result()

        async def _execute(_args, execution_ctx):
            db = execution_ctx.db
            project_id = execution_ctx.project_id
            language = execution_ctx.language

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
                            for value in ver.data.values():
                                if isinstance(value, dict):
                                    lang_data = value
                                    break
                        if isinstance(lang_data, dict):
                            title = str(lang_data.get("title") or lang_data.get("name") or "")

            story_entity_folders = list_story_entity_folders(db, project_id=project_id)
            folder_content_map = build_story_entity_folder_content_map(
                db,
                project_id=project_id,
                language=language,
                fallback_language=language,
            )
            story_entities = (
                db.query(StoryEntity)
                .filter(StoryEntity.project_id == project_id)
                .order_by(StoryEntity.display_order.asc())
                .all()
            )
            entity_names = _latest_names(db, STORY_ENTITY_TYPE, [entity.id for entity in story_entities], language)

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
                for folder in folder_rows:
                    nodes.append((_sort_key(int(folder.display_order or 0), True, folder.id), 0, folder))
                for entity in entity_rows:
                    nodes.append((_sort_key(int(entity.display_order or 0), False, entity.id), 1, entity))
                nodes.sort(key=lambda item: item[0])

                children: list[dict[str, Any]] = []
                for _key, kind_weight, row in nodes:
                    if kind_weight == 0:
                        children.append(
                            {
                                "nodeType": "folder",
                                "id": str(row.id),
                                "name": str(folder_content_map.get(row.id, {}).get("name") or ""),
                                "children": _walk_entities(row.id),
                            }
                        )
                    else:
                        children.append(
                            {
                                "nodeType": "entity",
                                "id": str(row.id),
                                "name": entity_names.get(row.id, ""),
                                "kind": str(row.kind),
                            }
                        )
                return children

            story_entity_tree = _walk_entities(None)

            outlines = (
                db.query(Outline)
                .filter(Outline.project_id == project_id)
                .order_by(Outline.position.asc(), Outline.created_at.asc(), Outline.id.asc())
                .all()
            )
            outline_names = _latest_names(db, "outline", [outline.id for outline in outlines], language)
            numbering = _build_outline_numbering(outlines)

            manuscript_map: dict[UUID, UUID] = {}
            ms_rows = (
                db.query(Manuscript.chapter_id, Manuscript.id)
                .join(Outline, Outline.id == Manuscript.chapter_id)
                .filter(Outline.project_id == project_id)
                .all()
            )
            for chapter_id, manuscript_id in ms_rows:
                manuscript_map[chapter_id] = manuscript_id

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
                        manuscript_id = manuscript_map.get(row.id)
                        node["manuscriptId"] = str(manuscript_id) if manuscript_id else None
                    children = _walk_outline(row.id)
                    if children:
                        node["children"] = children
                    nodes.append(node)
                return nodes

            outline_tree = _walk_outline(None)

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

            return ToolExecutionOutcome(
                lifecycle="applied",
                result=make_result(
                    "Project tree retrieved",
                    data={
                        "tree": {
                            "title": title,
                            "storyEntities": story_entity_tree,
                            "outline": outline_tree,
                            "timeline": timeline_summary,
                        },
                    },
                ),
            )

        bindings = [
            ToolBinding(
                spec=spec,
                meta=ToolBindingMeta(
                    feature_key="project_tree",
                    category="read",
                    op="get_tree",
                    target_kind="project_tree",
                ),
                validate=_validate,
                execute=_execute,
                build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
                    feature_key="project_tree",
                    category="read",
                    op="get_tree",
                    target_kind="project_tree",
                    target_id=None,
                    merge_key=None,
                ),
            )
        ]
        return filter_allowed_bindings(ctx, bindings)

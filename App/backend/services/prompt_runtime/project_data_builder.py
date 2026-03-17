from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import (
    Act,
    BasicInfo,
    Chapter,
    Guidelines,
    Manuscript,
    Outline,
    StoryEntity,
)
from ...models.translation_models import ObjectVersion
from ...utils.story_entities import STORY_ENTITY_TYPE
from ..basic_info_utils import basic_info_summary_text, normalize_basic_info_data
from ..sidecar_client import SidecarClient
from ..story_entity_tree_service import build_story_entity_folder_path_map, list_story_entity_folders


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
                        "name": str(row.name or ""),
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

    outlines = db.query(Outline).filter(Outline.project_id == project_id).order_by(Outline.order.asc()).all()
    acts = (
        db.query(Act)
        .join(Outline, Outline.id == Act.outline_id)
        .filter(Outline.project_id == project_id)
        .order_by(Outline.order.asc(), Act.order.asc())
        .all()
    )
    chapters = (
        db.query(Chapter)
        .join(Act, Act.id == Chapter.act_id)
        .join(Outline, Outline.id == Act.outline_id)
        .filter(Outline.project_id == project_id)
        .order_by(Outline.order.asc(), Act.order.asc(), Chapter.order.asc())
        .all()
    )
    manuscripts = (
        db.query(Manuscript)
        .join(Chapter, Chapter.id == Manuscript.chapter_id)
        .join(Act, Act.id == Chapter.act_id)
        .join(Outline, Outline.id == Act.outline_id)
        .filter(Outline.project_id == project_id)
        .all()
    )

    latest: dict[tuple[str, UUID], dict[str, Any]] = {}

    def get_latest(object_type: str, object_id: UUID) -> dict[str, Any]:
        key = (object_type, object_id)
        if key not in latest:
            latest[key] = _latest_version_data(db, object_type, object_id)
        return latest[key]

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

    folder_path_map = build_story_entity_folder_path_map(db, project_id=project_id)

    def build_story_entities_payload(lang: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        payload_map: dict[UUID, dict[str, Any]] = {}
        for row in story_entities:
            payload_map[row.id] = _story_entity_payload(
                row,
                lang_data=_lang_data(get_latest(STORY_ENTITY_TYPE, row.id), lang),
                folder_path=folder_path_map.get(row.folder_id, []) if row.folder_id else [],
            )
        story_entity_tree = _build_story_entity_tree(
            folders=story_entity_folders,
            entities=story_entities,
            entity_payloads=payload_map,
        )
        return _flatten_story_entity_tree(story_entity_tree), story_entity_tree

    chapter_by_id = {chapter.id: chapter for chapter in chapters}
    manuscript_by_chapter: dict[UUID, Manuscript] = {ms.chapter_id: ms for ms in manuscripts}

    acts_by_outline: dict[UUID, list[Act]] = {}
    for act in acts:
        acts_by_outline.setdefault(act.outline_id, []).append(act)
    for values in acts_by_outline.values():
        values.sort(key=lambda item: int(item.order or 0))

    chapters_by_act: dict[UUID, list[Chapter]] = {}
    for chapter in chapters:
        chapters_by_act.setdefault(chapter.act_id, []).append(chapter)
    for values in chapters_by_act.values():
        values.sort(key=lambda item: int(item.order or 0))

    def build_outline_payload(lang: str) -> dict[str, Any] | None:
        outline_items: list[dict[str, Any]] = []
        for outline in sorted(outlines, key=lambda item: int(item.order or 0)):
            outline_data = _lang_data(get_latest("outline", outline.id), lang)
            outline_acts: list[dict[str, Any]] = []
            for act in acts_by_outline.get(outline.id, []):
                act_data = _lang_data(get_latest("act", act.id), lang)
                act_chapters: list[dict[str, Any]] = []
                for chapter in chapters_by_act.get(act.id, []):
                    chapter_data = _lang_data(get_latest("chapter", chapter.id), lang)
                    manuscript = manuscript_by_chapter.get(chapter.id)
                    act_chapters.append(
                        {
                            "id": str(chapter.id),
                            "name": str(chapter_data.get("name") or ""),
                            "description": str(chapter_data.get("description") or ""),
                            "content": str(chapter_data.get("content") or ""),
                            "order": int(chapter.order or 0),
                            "actId": str(act.id),
                            "manuscriptId": str(manuscript.id) if manuscript is not None else "",
                        }
                    )

                outline_acts.append(
                    {
                        "id": str(act.id),
                        "name": str(act_data.get("name") or ""),
                        "description": str(act_data.get("description") or ""),
                        "content": str(act_data.get("content") or ""),
                        "order": int(act.order or 0),
                        "outlineId": str(outline.id),
                        "chapters": act_chapters,
                    }
                )

            outline_items.append(
                {
                    "id": str(outline.id),
                    "name": str(outline_data.get("name") or ""),
                    "description": str(outline_data.get("description") or ""),
                    "content": str(outline_data.get("content") or ""),
                    "order": int(outline.order or 0),
                    "acts": outline_acts,
                }
            )
        return {"outlines": outline_items} if outline_items else None

    async def build_manuscripts_payload(lang: str) -> list[dict[str, Any]]:
        sorted_manuscripts = sorted(
            manuscripts,
            key=lambda ms: int((chapter_by_id.get(ms.chapter_id).order if chapter_by_id.get(ms.chapter_id) else 0) or 0),
        )
        payload: list[dict[str, Any]] = []
        for manuscript in sorted_manuscripts:
            manuscript_data = _lang_data(get_latest("manuscript", manuscript.id), lang)
            chapter = chapter_by_id.get(manuscript.chapter_id)
            chapter_data = _lang_data(get_latest("chapter", chapter.id), lang) if chapter is not None else {}

            markdown = ""
            doc = manuscript_data.get("doc")
            if isinstance(doc, dict):
                markdown = await sidecar_client.doc_to_markdown(doc)

            payload.append(
                {
                    "id": str(manuscript.id),
                    "chapterId": str(manuscript.chapter_id),
                    "chapterName": str(chapter_data.get("name") or ""),
                    "content": markdown,
                    "wordCount": int(manuscript_data.get("wordCount") or len(markdown.split())),
                }
            )
        return payload

    story_entities_payload, story_entity_tree_payload = build_story_entities_payload(language)
    outline_payload = build_outline_payload(language)
    manuscripts_payload = await build_manuscripts_payload(language)

    all_languages: set[str] = set()
    for object_type, rows in [
        ("basic_info", [basic] if basic is not None else []),
        ("guidelines", [guidelines] if guidelines is not None else []),
        (STORY_ENTITY_TYPE, story_entities),
        ("outline", outlines),
        ("act", acts),
        ("chapter", chapters),
        ("manuscript", manuscripts),
    ]:
        for row in rows:
            all_languages.update(get_latest(object_type, row.id).keys())
    if not all_languages:
        all_languages.add(language)

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
            "manuscripts": await build_manuscripts_payload(lang),
        }

    return {
        "basicInfo": basic_info,
        "guidelines": guideline_payload,
        "storyEntities": story_entities_payload,
        "storyEntityTree": story_entity_tree_payload,
        "outline": outline_payload,
        "manuscripts": manuscripts_payload,
        "contentByLang": content_by_lang,
    }

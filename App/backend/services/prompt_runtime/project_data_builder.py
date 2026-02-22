from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import (
    Act,
    BasicInfo,
    Chapter,
    Character,
    Guidelines,
    Location,
    LorebookEntry,
    Manuscript,
    Organization,
    Outline,
)
from ...models.translation_models import ObjectVersion
from ..sidecar_client import SidecarClient


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


def _story_object_payload(row: Any, object_type: str, lang_data: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": object_type,
        "id": str(row.id),
        "name": str(lang_data.get("name") or ""),
        "description": str(lang_data.get("description") or ""),
        "content": str(lang_data.get("content") or ""),
        "imagePrompt": getattr(row, "image_prompt", None),
        "imagePromptPositive": getattr(row, "image_prompt_positive", None),
        "imagePromptNegative": getattr(row, "image_prompt_negative", None),
    }


async def build_project_data(
    db: Session,
    project_id: UUID,
    language: str,
    sidecar_client: SidecarClient,
) -> dict[str, Any]:
    basic = db.query(BasicInfo).filter(BasicInfo.project_id == project_id).first()
    guidelines = db.query(Guidelines).filter(Guidelines.project_id == project_id).first()

    characters = db.query(Character).filter(Character.project_id == project_id).order_by(Character.order.asc()).all()
    organizations = db.query(Organization).filter(Organization.project_id == project_id).order_by(Organization.order.asc()).all()
    locations = db.query(Location).filter(Location.project_id == project_id).order_by(Location.order.asc()).all()
    lorebooks = db.query(LorebookEntry).filter(LorebookEntry.project_id == project_id).order_by(LorebookEntry.order.asc()).all()

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

    # Latest per-object data cache for current build.
    latest: dict[tuple[str, UUID], dict[str, Any]] = {}

    def get_latest(object_type: str, object_id: UUID) -> dict[str, Any]:
        key = (object_type, object_id)
        if key not in latest:
            latest[key] = _latest_version_data(db, object_type, object_id)
        return latest[key]

    # basicInfo
    if basic is not None:
        basic_data = _lang_data(get_latest("basic_info", basic.id), language)
        basic_info = {
            "id": str(basic.id),
            "title": str(basic_data.get("title") or ""),
            "logline": str(basic_data.get("logline") or ""),
            "genre": str(basic_data.get("genre") or ""),
        }
    else:
        basic_info = {"id": "", "title": "", "logline": "", "genre": ""}

    # guidelines
    if guidelines is not None:
        guideline_data = _lang_data(get_latest("guidelines", guidelines.id), language)
        guideline_payload = {
            "id": str(guidelines.id),
            "authorNote": str(guideline_data.get("authorNote") or ""),
        }
    else:
        guideline_payload = {"id": "", "authorNote": ""}

    # story objects
    story_objects: list[dict[str, Any]] = []
    if basic is not None:
        story_objects.append({
            "type": "basic_info",
            "id": str(basic.id),
            "name": str(basic_data.get("title") or ""),
            "description": str(basic_data.get("logline") or ""),
            "content": str(basic_data.get("genre") or ""),
            "imagePrompt": getattr(basic, "image_prompt", None),
            "imagePromptPositive": getattr(basic, "image_prompt_positive", None),
            "imagePromptNegative": getattr(basic, "image_prompt_negative", None),
        })
    for object_type, rows in [
        ("character", characters),
        ("organization", organizations),
        ("location", locations),
        ("lorebook", lorebooks),
    ]:
        for row in rows:
            story_objects.append(
                _story_object_payload(
                    row,
                    object_type,
                    _lang_data(get_latest(object_type, row.id), language),
                )
            )

    # Build chapter and manuscript maps once.
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
                try:
                    markdown = await sidecar_client.doc_to_markdown(doc)
                except Exception:
                    markdown = ""

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

    outline_payload = build_outline_payload(language)
    manuscripts_payload = await build_manuscripts_payload(language)

    # languages snapshot
    all_languages: set[str] = set()
    for object_type, rows in [
        ("basic_info", [basic] if basic is not None else []),
        ("guidelines", [guidelines] if guidelines is not None else []),
        ("character", characters),
        ("organization", organizations),
        ("location", locations),
        ("lorebook", lorebooks),
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
        if basic is not None:
            lang_basic = _lang_data(get_latest("basic_info", basic.id), lang)
            lang_basic_info = {
                "id": str(basic.id),
                "title": str(lang_basic.get("title") or ""),
                "logline": str(lang_basic.get("logline") or ""),
                "genre": str(lang_basic.get("genre") or ""),
            }
        else:
            lang_basic_info = {"id": "", "title": "", "logline": "", "genre": ""}

        lang_objects: list[dict[str, Any]] = []
        if basic is not None:
            lang_objects.append({
                "type": "basic_info",
                "id": str(basic.id),
                "name": str(lang_basic.get("title") or ""),
                "description": str(lang_basic.get("logline") or ""),
                "content": str(lang_basic.get("genre") or ""),
                "imagePrompt": getattr(basic, "image_prompt", None),
                "imagePromptPositive": getattr(basic, "image_prompt_positive", None),
                "imagePromptNegative": getattr(basic, "image_prompt_negative", None),
            })
        for object_type, rows in [
            ("character", characters),
            ("organization", organizations),
            ("location", locations),
            ("lorebook", lorebooks),
        ]:
            for row in rows:
                lang_objects.append(_story_object_payload(row, object_type, _lang_data(get_latest(object_type, row.id), lang)))

        for outline in outlines:
            outline_data = _lang_data(get_latest("outline", outline.id), lang)
            lang_objects.append(
                {
                    "type": "outline",
                    "id": str(outline.id),
                    "name": str(outline_data.get("name") or ""),
                    "description": str(outline_data.get("description") or ""),
                    "content": str(outline_data.get("content") or ""),
                }
            )

        for act in sorted(acts, key=lambda item: int(item.order or 0)):
            act_data = _lang_data(get_latest("act", act.id), lang)
            lang_objects.append(
                {
                    "type": "act",
                    "id": str(act.id),
                    "name": str(act_data.get("name") or ""),
                    "description": str(act_data.get("description") or ""),
                    "content": str(act_data.get("content") or ""),
                }
            )

        for chapter in sorted(chapters, key=lambda item: int(item.order or 0)):
            chapter_data = _lang_data(get_latest("chapter", chapter.id), lang)
            lang_objects.append(
                {
                    "type": "chapter",
                    "id": str(chapter.id),
                    "name": str(chapter_data.get("name") or ""),
                    "description": str(chapter_data.get("description") or ""),
                    "content": str(chapter_data.get("content") or ""),
                }
            )

        content_by_lang[lang] = {
            "basicInfo": lang_basic_info,
            "objects": lang_objects,
            "outline": build_outline_payload(lang),
            "manuscripts": await build_manuscripts_payload(lang),
        }

    return {
        "basicInfo": basic_info,
        "objects": story_objects,
        "outline": outline_payload,
        "manuscripts": manuscripts_payload,
        "guidelines": guideline_payload,
        "contentByLang": content_by_lang,
    }

from __future__ import annotations

from typing import Any, cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from ..models.db_models import (
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
    Project,
    Thread,
)
from ..utils.object_type_aliases import normalize_object_type


LOREBOOK_TYPE = normalize_object_type("lorebook")

OBJECT_TYPE_MODEL_MAP = {
    "basic_info": BasicInfo,
    "guidelines": Guidelines,
    "character": Character,
    "organization": Organization,
    "location": Location,
    LOREBOOK_TYPE: LorebookEntry,
    "outline": Outline,
    "act": Act,
    "chapter": Chapter,
    "manuscript": Manuscript,
}

DIRECT_PROJECT_OBJECT_TYPES = {
    "basic_info",
    "guidelines",
    "character",
    "organization",
    "location",
    LOREBOOK_TYPE,
    "outline",
}


def get_object_model_class(object_type: str):
    normalized_type = normalize_object_type(object_type)
    model_class = OBJECT_TYPE_MODEL_MAP.get(normalized_type)
    if model_class is None:
        raise HTTPException(status_code=400, detail=f"Unknown object type: {normalized_type}")
    return model_class


def require_owned_project(db: Session, *, user_id: UUID, project_id: UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def require_owned_thread(db: Session, *, user_id: UUID, thread_id: UUID) -> Thread:
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == user_id).first()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


def require_owned_object(
    db: Session,
    *,
    user_id: UUID,
    object_type: str,
    object_id: UUID,
    project_id: UUID | None = None,
) -> Any:
    normalized_type = normalize_object_type(object_type)
    model_class = get_object_model_class(normalized_type)
    query = db.query(model_class)

    if normalized_type in DIRECT_PROJECT_OBJECT_TYPES:
        query = query.join(Project, Project.id == model_class.project_id).filter(Project.user_id == user_id)
        if project_id is not None:
            query = query.filter(Project.id == project_id)
    elif normalized_type == "act":
        query = (
            query.join(Outline, model_class.outline_id == Outline.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Project.user_id == user_id)
        )
        if project_id is not None:
            query = query.filter(Project.id == project_id)
    elif normalized_type == "chapter":
        query = (
            query.join(Act, model_class.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Project.user_id == user_id)
        )
        if project_id is not None:
            query = query.filter(Project.id == project_id)
        query = query.options(
            joinedload(Chapter.manuscript),
            joinedload(Chapter.act).joinedload(Act.outline),
        )
    elif normalized_type == "manuscript":
        query = (
            query.join(Chapter, model_class.chapter_id == Chapter.id)
            .join(Act, Chapter.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Project.user_id == user_id)
        )
        if project_id is not None:
            query = query.filter(Project.id == project_id)
        query = query.options(
            joinedload(Manuscript.chapter).joinedload(Chapter.act).joinedload(Act.outline),
        )

    obj = query.filter(model_class.id == object_id).first()
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{normalized_type} not found")
    return obj


def require_owned_manuscript(
    db: Session,
    *,
    user_id: UUID,
    manuscript_id: UUID,
    project_id: UUID | None = None,
) -> Manuscript:
    manuscript = require_owned_object(
        db,
        user_id=user_id,
        object_type="manuscript",
        object_id=manuscript_id,
        project_id=project_id,
    )
    return cast(Manuscript, manuscript)


def resolve_project_id_for_object(
    db: Session,
    *,
    object_type: str,
    object_id: UUID,
    user_id: UUID,
) -> UUID:
    normalized_type = normalize_object_type(object_type)

    if normalized_type in DIRECT_PROJECT_OBJECT_TYPES:
        model_class = get_object_model_class(normalized_type)
        row = (
            db.query(model_class.project_id)
            .join(Project, Project.id == model_class.project_id)
            .filter(model_class.id == object_id, Project.user_id == user_id)
            .first()
        )
        if row and isinstance(row[0], UUID):
            return row[0]
        raise HTTPException(status_code=404, detail=f"{normalized_type} not found")

    if normalized_type == "act":
        row = (
            db.query(Outline.project_id)
            .join(Act, Act.outline_id == Outline.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Act.id == object_id, Project.user_id == user_id)
            .first()
        )
        if row and isinstance(row[0], UUID):
            return row[0]
        raise HTTPException(status_code=404, detail="act not found")

    if normalized_type == "chapter":
        row = (
            db.query(Outline.project_id)
            .join(Act, Act.outline_id == Outline.id)
            .join(Chapter, Chapter.act_id == Act.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Chapter.id == object_id, Project.user_id == user_id)
            .first()
        )
        if row and isinstance(row[0], UUID):
            return row[0]
        raise HTTPException(status_code=404, detail="chapter not found")

    if normalized_type == "manuscript":
        row = (
            db.query(Outline.project_id)
            .join(Act, Act.outline_id == Outline.id)
            .join(Chapter, Chapter.act_id == Act.id)
            .join(Manuscript, Manuscript.chapter_id == Chapter.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Manuscript.id == object_id, Project.user_id == user_id)
            .first()
        )
        if row and isinstance(row[0], UUID):
            return row[0]
        raise HTTPException(status_code=404, detail="manuscript not found")

    raise HTTPException(status_code=400, detail=f"Unknown object type: {normalized_type}")

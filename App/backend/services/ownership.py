from __future__ import annotations

from typing import Any, cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from ..models.db_models import (
    BasicInfo,
    Guidelines,
    Manuscript,
    Outline,
    Project,
    StoryEntity,
    StoryEntityFolder,
    Timeline,
    TimelineEvent,
    TimelineTrack,
    Thread,
)

OBJECT_TYPE_MODEL_MAP = {
    "basic_info": BasicInfo,
    "guidelines": Guidelines,
    "story_entity_folder": StoryEntityFolder,
    "story_entity": StoryEntity,
    "outline": Outline,
    "manuscript": Manuscript,
    "timeline_track": TimelineTrack,
    "timeline_event": TimelineEvent,
}

DIRECT_PROJECT_OBJECT_TYPES = {
    "basic_info",
    "guidelines",
    "story_entity_folder",
    "story_entity",
    "outline",
}


def get_object_model_class(object_type: str):
    model_class = OBJECT_TYPE_MODEL_MAP.get(object_type)
    if model_class is None:
        raise HTTPException(status_code=400, detail=f"Unknown object type: {object_type}")
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
    normalized_type = object_type
    model_class = get_object_model_class(normalized_type)
    query = db.query(model_class)

    if normalized_type in DIRECT_PROJECT_OBJECT_TYPES:
        query = query.join(Project, Project.id == model_class.project_id).filter(Project.user_id == user_id)
        if project_id is not None:
            query = query.filter(Project.id == project_id)
    elif normalized_type == "manuscript":
        query = (
            query.join(Outline, model_class.chapter_id == Outline.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Outline.kind == "chapter")
            .filter(Project.user_id == user_id)
        )
        if project_id is not None:
            query = query.filter(Project.id == project_id)
        query = query.options(joinedload(Manuscript.chapter))
    elif normalized_type == "timeline_track":
        query = (
            query.join(Timeline, Timeline.id == TimelineTrack.timeline_id)
            .join(Project, Project.id == Timeline.project_id)
            .filter(Project.user_id == user_id)
        )
        if project_id is not None:
            query = query.filter(Project.id == project_id)
    elif normalized_type == "timeline_event":
        query = (
            query.join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
            .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
            .join(Project, Project.id == Timeline.project_id)
            .filter(Project.user_id == user_id)
        )
        if project_id is not None:
            query = query.filter(Project.id == project_id)

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
    normalized_type = object_type

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

    if normalized_type == "manuscript":
        row = (
            db.query(Outline.project_id)
            .join(Manuscript, Manuscript.chapter_id == Outline.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Manuscript.id == object_id, Outline.kind == "chapter", Project.user_id == user_id)
            .first()
        )
        if row and isinstance(row[0], UUID):
            return row[0]
        raise HTTPException(status_code=404, detail="manuscript not found")

    if normalized_type == "timeline_track":
        row = (
            db.query(Timeline.project_id)
            .join(TimelineTrack, TimelineTrack.timeline_id == Timeline.id)
            .join(Project, Project.id == Timeline.project_id)
            .filter(TimelineTrack.id == object_id, Project.user_id == user_id)
            .first()
        )
        if row and isinstance(row[0], UUID):
            return row[0]
        raise HTTPException(status_code=404, detail="timeline_track not found")

    if normalized_type == "timeline_event":
        row = (
            db.query(Timeline.project_id)
            .join(TimelineTrack, TimelineTrack.timeline_id == Timeline.id)
            .join(TimelineEvent, TimelineEvent.track_id == TimelineTrack.id)
            .join(Project, Project.id == Timeline.project_id)
            .filter(TimelineEvent.id == object_id, Project.user_id == user_id)
            .first()
        )
        if row and isinstance(row[0], UUID):
            return row[0]
        raise HTTPException(status_code=404, detail="timeline_event not found")

    raise HTTPException(status_code=400, detail=f"Unknown object type: {normalized_type}")

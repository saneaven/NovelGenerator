from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..services.object_service import object_service
from ..services.ownership import require_owned_project
from ..utils.story_entities import STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE
from .unified_object_routes import RichTextFormat, UnifiedObjectResponse


router = APIRouter(tags=["story-entity-tree"])


class StoryEntityTreeResponse(BaseModel):
    folders: list[UnifiedObjectResponse]
    entities: list[UnifiedObjectResponse]


def _main_language(current_user: User) -> str:
    settings = getattr(current_user, "settings", None)
    value = getattr(settings, "main_language", None)
    return str(value or "English")


@router.get(
    "/api/v1/projects/{project_id}/story-entity-tree",
    response_model=StoryEntityTreeResponse,
)
async def get_story_entity_tree(
    project_id: UUID,
    language: str | None = Query(None),
    rich_text_format: RichTextFormat = Query("tiptap"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    main_language = _main_language(current_user)
    requested_language = language or main_language
    folders = object_service.list_objects(
        db,
        project_id=project_id,
        object_type=STORY_ENTITY_FOLDER_TYPE,
        language=requested_language,
        rich_text_format=rich_text_format,
        fallback_language=main_language,
    )
    entities = object_service.list_objects(
        db,
        project_id=project_id,
        object_type=STORY_ENTITY_TYPE,
        language=requested_language,
        rich_text_format=rich_text_format,
        fallback_language=main_language,
    )
    return StoryEntityTreeResponse(
        folders=[UnifiedObjectResponse(**item) for item in folders],
        entities=[UnifiedObjectResponse(**item) for item in entities],
    )

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..services.demo_policy import require_demo_off
from ..services.object_service import object_service
from ..services.ownership import require_owned_project
from ..services.story_entity_tree_service import (
    collect_descendant_folder_ids,
    collect_descendant_story_entity_ids,
    create_story_entity_folder,
    delete_story_entity_folder_rows,
    list_story_entity_folders,
    move_story_entity,
    move_story_entity_folder,
    normalize_story_entity_parent,
    rename_story_entity_folder,
    require_story_entity_folder,
    serialize_story_entity_folder,
)
from ..utils.story_entities import STORY_ENTITY_TYPE


router = APIRouter(tags=["story-entity-folders"])


class StoryEntityFolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: UUID | None = None


class StoryEntityFolderRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class StoryEntityFolderMoveRequest(BaseModel):
    new_parent_id: UUID | None = None
    new_index: int | None = Field(default=None, ge=0)


class StoryEntityTreeMoveRequest(BaseModel):
    node_kind: Literal["folder", "entity"]
    node_id: UUID
    new_parent_folder_id: UUID | None = None
    new_index: int | None = Field(default=None, ge=0)


class StoryEntityFolderResponse(BaseModel):
    id: str
    project_id: str
    name: str
    parent_id: str | None
    display_order: int
    created_at: str | None
    updated_at: str | None


class StoryEntityFolderListResponse(BaseModel):
    folders: list[StoryEntityFolderResponse]


class StoryEntityFolderDeleteResponse(BaseModel):
    success: bool
    deleted_folder_ids: list[str]
    deleted_entity_ids: list[str]


class StoryEntityTreeMoveResponse(BaseModel):
    success: bool
    node_kind: Literal["folder", "entity"]
    node_id: str


def _clean_folder_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Folder name cannot be empty")
    return cleaned


def _serialize_folder(folder) -> StoryEntityFolderResponse:
    return StoryEntityFolderResponse(**serialize_story_entity_folder(folder))


def _commit_or_raise(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=message) from exc


@router.get(
    "/api/v1/projects/{project_id}/story-entity-folders",
    response_model=StoryEntityFolderListResponse,
)
async def get_story_entity_folders(
    project_id: UUID,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    folders = list_story_entity_folders(db, project_id=project_id)
    return StoryEntityFolderListResponse(folders=[_serialize_folder(folder) for folder in folders])


@router.post(
    "/api/v1/projects/{project_id}/story-entity-folders",
    response_model=StoryEntityFolderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_story_entity_folder_route(
    project_id: UUID,
    payload: StoryEntityFolderCreateRequest,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    folder = create_story_entity_folder(
        db,
        project_id=project_id,
        name=_clean_folder_name(payload.name),
        parent_id=payload.parent_id,
    )
    _commit_or_raise(db, "A folder with that name already exists in the target parent")
    db.refresh(folder)
    return _serialize_folder(folder)


@router.patch(
    "/api/v1/projects/{project_id}/story-entity-folders/{folder_id}",
    response_model=StoryEntityFolderResponse,
)
async def rename_story_entity_folder_route(
    project_id: UUID,
    folder_id: UUID,
    payload: StoryEntityFolderRenameRequest,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    folder = rename_story_entity_folder(
        db,
        project_id=project_id,
        folder_id=folder_id,
        name=_clean_folder_name(payload.name),
    )
    _commit_or_raise(db, "A folder with that name already exists in the target parent")
    db.refresh(folder)
    return _serialize_folder(folder)


@router.post(
    "/api/v1/projects/{project_id}/story-entity-folders/{folder_id}/move",
    response_model=StoryEntityFolderResponse,
)
async def move_story_entity_folder_route(
    project_id: UUID,
    folder_id: UUID,
    payload: StoryEntityFolderMoveRequest,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    folder = move_story_entity_folder(
        db,
        project_id=project_id,
        folder_id=folder_id,
        new_parent_folder_id=payload.new_parent_id,
        new_index=payload.new_index,
    )
    _commit_or_raise(db, "A folder with that name already exists in the target parent")
    db.refresh(folder)
    return _serialize_folder(folder)


@router.delete(
    "/api/v1/projects/{project_id}/story-entity-folders/{folder_id}",
    response_model=StoryEntityFolderDeleteResponse,
)
async def delete_story_entity_folder_route(
    project_id: UUID,
    folder_id: UUID,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    folder = require_story_entity_folder(db, project_id=project_id, folder_id=folder_id)
    parent_id = folder.parent_id
    folder_ids = collect_descendant_folder_ids(db, project_id=project_id, folder_id=folder_id)
    entity_ids = collect_descendant_story_entity_ids(db, project_id=project_id, folder_ids=folder_ids)

    for entity_id in entity_ids:
        object_service.delete_object(
            db,
            project_id=project_id,
            object_type=STORY_ENTITY_TYPE,
            object_id=entity_id,
            user_id=current_user.id,
        )

    delete_story_entity_folder_rows(db, project_id=project_id, folder_ids=folder_ids)
    normalize_story_entity_parent(db, project_id=project_id, parent_folder_id=parent_id)
    db.commit()

    return StoryEntityFolderDeleteResponse(
        success=True,
        deleted_folder_ids=[str(item) for item in folder_ids],
        deleted_entity_ids=[str(item) for item in entity_ids],
    )


@router.post(
    "/api/v1/projects/{project_id}/story-entities/tree/move",
    response_model=StoryEntityTreeMoveResponse,
)
async def move_story_entity_tree_node(
    project_id: UUID,
    payload: StoryEntityTreeMoveRequest,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)

    if payload.node_kind == "folder":
        move_story_entity_folder(
            db,
            project_id=project_id,
            folder_id=payload.node_id,
            new_parent_folder_id=payload.new_parent_folder_id,
            new_index=payload.new_index,
        )
    else:
        move_story_entity(
            db,
            project_id=project_id,
            entity_id=payload.node_id,
            new_parent_folder_id=payload.new_parent_folder_id,
            new_index=payload.new_index,
        )

    _commit_or_raise(db, "Unable to move story entity tree node")
    return StoryEntityTreeMoveResponse(
        success=True,
        node_kind=payload.node_kind,
        node_id=str(payload.node_id),
    )

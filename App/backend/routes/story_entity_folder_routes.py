from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..services.demo_policy import require_demo_off
from ..services.object_service import object_service
from ..services.ownership import require_owned_project
from ..services.story_entity_tree_service import (
    build_story_entity_folder_content_map,
    collect_descendant_folder_ids,
    collect_descendant_story_entity_ids,
    list_story_entity_folders,
    move_story_entity,
    move_story_entity_folder,
    require_story_entity_folder,
    serialize_story_entity_folder,
)
from ..utils.story_entities import STORY_ENTITY_FOLDER_TYPE


router = APIRouter(tags=["story-entity-folders"])


class StoryEntityFolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    language: str = "English"
    parent_id: UUID | None = None


class StoryEntityFolderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    language: str = "English"
    create_new_version: bool = True


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
    description: str
    parent_id: str | None
    display_order: int
    created_at: str | None
    updated_at: str | None
    data: dict[str, dict[str, str]]
    version: dict[str, Any]


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


def _extract_lang_data(payload: dict[str, Any], language: str) -> dict[str, str]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    if isinstance(data.get(language), dict):
        lang_data = data[language]
        return {
            "name": str(lang_data.get("name") or ""),
            "description": str(lang_data.get("description") or ""),
        }
    for value in data.values():
        if isinstance(value, dict):
            return {
                "name": str(value.get("name") or ""),
                "description": str(value.get("description") or ""),
            }
    return {"name": "", "description": ""}


def _serialize_folder_payload(payload: dict[str, Any], *, language: str | None = None) -> StoryEntityFolderResponse:
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    display = _extract_lang_data(payload, language or "")
    return StoryEntityFolderResponse(
        id=str(payload.get("id") or ""),
        project_id=str(metadata.get("project_id") or ""),
        name=display["name"],
        description=display["description"],
        parent_id=str(metadata.get("parent_id")) if metadata.get("parent_id") else None,
        display_order=int(metadata.get("display_order") or 0),
        created_at=str(metadata.get("created_at")) if metadata.get("created_at") else None,
        updated_at=str(metadata.get("updated_at")) if metadata.get("updated_at") else None,
        data=payload.get("data") if isinstance(payload.get("data"), dict) else {},
        version=payload.get("version") if isinstance(payload.get("version"), dict) else {"id": None, "number": 0, "created_at": None},
    )


@router.get(
    "/api/v1/projects/{project_id}/story-entity-folders",
    response_model=StoryEntityFolderListResponse,
)
async def get_story_entity_folders(
    project_id: UUID,
    language: str | None = Query(None),
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    folders = list_story_entity_folders(db, project_id=project_id)
    content_map = build_story_entity_folder_content_map(
        db,
        project_id=project_id,
        language=language,
    )
    return StoryEntityFolderListResponse(
        folders=[
            StoryEntityFolderResponse(
                **serialize_story_entity_folder(folder, content=content_map.get(folder.id))
            )
            for folder in folders
        ]
    )


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
    created = object_service.create_object(
        db,
        project_id=project_id,
        object_type=STORY_ENTITY_FOLDER_TYPE,
        data={
            "name": _clean_folder_name(payload.name),
            "description": str(payload.description or ""),
        },
        language=payload.language,
        metadata={"parent_id": payload.parent_id},
        user_request="User Creation",
        created_by=current_user.id,
    )
    db.commit()
    return _serialize_folder_payload(created, language=payload.language)


@router.patch(
    "/api/v1/projects/{project_id}/story-entity-folders/{folder_id}",
    response_model=StoryEntityFolderResponse,
)
async def update_story_entity_folder_route(
    project_id: UUID,
    folder_id: UUID,
    payload: StoryEntityFolderUpdateRequest,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    current = object_service.get_object(
        db,
        object_type=STORY_ENTITY_FOLDER_TYPE,
        object_id=folder_id,
        project_id=project_id,
    )
    if current is None:
        raise HTTPException(status_code=404, detail="Story entity folder not found")

    next_data = dict(_extract_lang_data(current, payload.language))
    if payload.name is not None:
        next_data["name"] = _clean_folder_name(payload.name)
    if payload.description is not None:
        next_data["description"] = str(payload.description or "")

    updated = object_service.update_object(
        db,
        project_id=project_id,
        object_type=STORY_ENTITY_FOLDER_TYPE,
        object_id=folder_id,
        data=next_data,
        language=payload.language,
        user_request="User Edit",
        created_by=current_user.id,
        create_new_version=payload.create_new_version,
    )
    db.commit()
    return _serialize_folder_payload(updated, language=payload.language)


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
    db.commit()
    content_map = build_story_entity_folder_content_map(db, project_id=project_id)
    return StoryEntityFolderResponse(
        **serialize_story_entity_folder(folder, content=content_map.get(folder.id))
    )


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
    folder_ids = collect_descendant_folder_ids(db, project_id=project_id, folder_id=folder_id)
    entity_ids = collect_descendant_story_entity_ids(db, project_id=project_id, folder_ids=folder_ids)
    object_service.delete_object(
        db,
        project_id=project_id,
        object_type=STORY_ENTITY_FOLDER_TYPE,
        object_id=folder.id,
        user_id=current_user.id,
    )
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

    db.commit()
    return StoryEntityTreeMoveResponse(
        success=True,
        node_kind=payload.node_kind,
        node_id=str(payload.node_id),
    )

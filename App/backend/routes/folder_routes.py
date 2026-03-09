"""API routes for prompt folder management"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..schemas.folders import FolderCreate, FolderRename, FolderMoveRequest, FolderResponse
from ..services.demo_policy import require_demo_off
from ..services.folder_service import FolderService

router = APIRouter(prefix="/api/v1/folders", tags=["folders"])


def _get_active_preset_id(current_user: User) -> uuid.UUID:
    if not current_user.settings or not current_user.settings.active_preset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active preset set. Please select or create a preset first.",
        )
    return current_user.settings.active_preset_id


def _folder_to_response(db: Session, folder) -> FolderResponse:
    path = FolderService.get_folder_path(db, folder.id)
    return FolderResponse(
        id=str(folder.id),
        name=folder.name,
        path=path,
        parent_id=str(folder.parent_id) if folder.parent_id else None,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


@router.post("", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    data: FolderCreate,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new folder"""
    preset_id = _get_active_preset_id(current_user)
    parent_id = uuid.UUID(data.parent_id) if data.parent_id else None

    folder = FolderService.create_folder(
        db, current_user.id, preset_id, data.name, parent_id
    )
    db.commit()
    return _folder_to_response(db, folder)


@router.patch("/{folder_id}", response_model=FolderResponse)
async def rename_folder(
    folder_id: str,
    data: FolderRename,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rename a folder"""
    preset_id = _get_active_preset_id(current_user)
    folder = FolderService.rename_folder(
        db, current_user.id, preset_id, uuid.UUID(folder_id), data.name
    )
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    db.commit()
    return _folder_to_response(db, folder)


@router.post("/{folder_id}/move", response_model=FolderResponse)
async def move_folder(
    folder_id: str,
    data: FolderMoveRequest,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move a folder to a new parent"""
    preset_id = _get_active_preset_id(current_user)
    new_parent_id = uuid.UUID(data.new_parent_id) if data.new_parent_id else None

    folder = FolderService.move_folder(
        db, current_user.id, preset_id, uuid.UUID(folder_id), new_parent_id
    )
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to move folder. Folder not found or circular reference detected.",
        )

    db.commit()
    return _folder_to_response(db, folder)


@router.delete("/{folder_id}", status_code=status.HTTP_200_OK)
async def delete_folder(
    folder_id: str,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a folder and all its contents (cascade)"""
    preset_id = _get_active_preset_id(current_user)
    success = FolderService.delete_folder(
        db, current_user.id, preset_id, uuid.UUID(folder_id)
    )
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    db.commit()
    return {"success": True}

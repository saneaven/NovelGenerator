"""API routes for prompt preset management"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..schemas.presets import (
    PresetCreate,
    PresetUpdate,
    PresetDuplicateRequest,
    PresetListItem,
    PresetResponse,
    ActivePresetResponse,
    PresetImportData
)
from ..services.preset_service import preset_service

router = APIRouter(prefix="/api/v1/presets", tags=["presets"])


@router.get(
    "",
    response_model=List[PresetListItem]
)
async def list_all_presets(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all presets for the current user"""
    return preset_service.get_all_presets(db=db, user_id=current_user.id)


@router.get(
    "/active",
    response_model=ActivePresetResponse
)
async def get_active_preset(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get the currently active preset"""
    preset = preset_service.get_active_preset(db=db, user_id=current_user.id)
    if not preset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active preset found"
        )
    return preset


@router.post(
    "/active/{preset_id}",
    status_code=status.HTTP_200_OK
)
async def set_active_preset(
    preset_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Set the active preset"""
    try:
        preset_uuid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid preset ID format"
        )

    success = preset_service.set_active_preset(
        db=db, user_id=current_user.id, preset_id=preset_uuid
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preset with ID '{preset_id}' not found"
        )
    return {"message": "Active preset updated successfully"}


@router.post(
    "",
    response_model=PresetResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_preset(
    data: PresetCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new preset"""
    try:
        return preset_service.create_preset(
            db=db,
            user_id=current_user.id,
            name=data.name,
            description=data.description,
            initialize_with_defaults=data.initialize_with_defaults
        )
    except Exception as e:
        if "uq_preset_user_name" in str(e):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A preset with name '{data.name}' already exists"
            )
        raise


@router.post(
    "/{preset_id}/duplicate",
    response_model=PresetResponse,
    status_code=status.HTTP_201_CREATED
)
async def duplicate_preset(
    preset_id: str,
    data: PresetDuplicateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Duplicate an existing preset with all its data"""
    try:
        preset_uuid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid preset ID format"
        )

    try:
        result = preset_service.duplicate_preset(
            db=db,
            user_id=current_user.id,
            source_preset_id=preset_uuid,
            new_name=data.new_name,
            new_description=data.new_description
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Preset with ID '{preset_id}' not found"
            )
        return result
    except Exception as e:
        if "uq_preset_user_name" in str(e):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A preset with name '{data.new_name}' already exists"
            )
        raise


@router.get(
    "/{preset_id}",
    response_model=PresetResponse
)
async def get_preset(
    preset_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a single preset by ID"""
    try:
        preset_uuid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid preset ID format"
        )

    preset = preset_service.get_preset(
        db=db, user_id=current_user.id, preset_id=preset_uuid
    )
    if not preset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preset with ID '{preset_id}' not found"
        )
    return preset


@router.put(
    "/{preset_id}",
    response_model=PresetResponse
)
async def update_preset(
    preset_id: str,
    data: PresetUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update preset metadata (name, description)"""
    try:
        preset_uuid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid preset ID format"
        )

    try:
        result = preset_service.update_preset(
            db=db,
            user_id=current_user.id,
            preset_id=preset_uuid,
            name=data.name,
            description=data.description
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Preset with ID '{preset_id}' not found"
            )
        return result
    except Exception as e:
        if "uq_preset_user_name" in str(e):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A preset with name '{data.name}' already exists"
            )
        raise


@router.delete(
    "/{preset_id}",
    status_code=status.HTTP_200_OK
)
async def delete_preset(
    preset_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a preset and all its data"""
    try:
        preset_uuid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid preset ID format"
        )

    deleted = preset_service.delete_preset(
        db=db, user_id=current_user.id, preset_id=preset_uuid
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete preset. Either it was not found or it is the only preset."
        )
    return {"message": "Preset deleted successfully"}


@router.get(
    "/{preset_id}/export",
    response_model=dict
)
async def export_preset(
    preset_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Export a preset with all its data as JSON"""
    try:
        preset_uuid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid preset ID format"
        )

    result = preset_service.export_preset(
        db=db, user_id=current_user.id, preset_id=preset_uuid
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preset with ID '{preset_id}' not found"
        )
    return result


@router.post(
    "/import",
    response_model=PresetResponse,
    status_code=status.HTTP_201_CREATED
)
async def import_preset(
    data: PresetImportData,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Import a preset from exported JSON data"""
    try:
        return preset_service.import_preset(
            db=db,
            user_id=current_user.id,
            name=data.name,
            description=data.description,
            data=data.data
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        if "uq_preset_user_name" in str(e):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A preset with name '{data.name}' already exists"
            )
        raise

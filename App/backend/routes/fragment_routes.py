"""API routes for prompt fragment management"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional, List
import uuid

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..schemas.fragments import (
    FragmentContentResponse,
    FragmentCreate,
    FragmentPatch,
    FragmentUpdate,
    FragmentVersionResponse,
    FragmentVersionHistoryItem,
    FragmentListItem,
    FragmentWithContent,
    FragmentTreeResponse,
    FragmentRestoreRequest,
    FragmentMoveRequest,
    FragmentValidationRequest,
    FragmentValidationResponse
)
from ..services.fragment_service import fragment_service, FragmentConflictError
from ..services.folder_service import FolderService
from ..services.default_preset_seed import load_default_preset_seed
from ..services.prompt_runtime.template_renderer import load_user_fragment_map
from ..services.template_engine import format_template_error, validate_template_source
from ..services.demo_policy import require_demo_off

router = APIRouter(prefix="/api/v1/fragments", tags=["fragments"])


def get_active_preset_id(current_user: User) -> uuid.UUID:
    """Get active preset ID from user settings, raise 400 if not set"""
    if not current_user.settings or not current_user.settings.active_preset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active preset set. Please select or create a preset first."
        )
    return current_user.settings.active_preset_id


def _parse_folder_id(folder_id: Optional[str]) -> Optional[uuid.UUID]:
    """Parse optional folder_id string to UUID."""
    if folder_id is None:
        return None
    return uuid.UUID(folder_id)


@router.get(
    "",
    response_model=List[FragmentListItem]
)
async def list_all_fragments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all active fragments for the current user's active preset"""
    preset_id = get_active_preset_id(current_user)
    return fragment_service.get_all_fragments(db=db, user_id=current_user.id, preset_id=preset_id)


@router.get(
    "/all",
    response_model=List[FragmentWithContent]
)
async def get_all_fragments_with_content(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all active fragments with content for the template engine"""
    preset_id = get_active_preset_id(current_user)
    return fragment_service.get_all_fragments_with_content(db=db, user_id=current_user.id, preset_id=preset_id)


@router.get(
    "/tree",
    response_model=FragmentTreeResponse
)
async def get_folder_tree(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get folder tree structure with all fragments"""
    preset_id = get_active_preset_id(current_user)
    return fragment_service.get_folder_tree(db=db, user_id=current_user.id, preset_id=preset_id)


@router.post(
    "/validate",
    response_model=FragmentValidationResponse
)
async def validate_fragment(
    data: FragmentValidationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Validate fragment content for syntax errors and literal include references."""
    preset_id = get_active_preset_id(current_user)
    fragment_map = load_user_fragment_map(db, current_user.id, preset_id)

    try:
        report = validate_template_source(data.content, fragment_map=fragment_map)
        return FragmentValidationResponse(
            is_valid=len(report.errors) == 0,
            syntax_errors=report.errors,
            warnings=report.warnings,
            referenced_fragments=report.referenced_fragments,
        )
    except Exception as exc:
        return FragmentValidationResponse(
            is_valid=False,
            syntax_errors=[format_template_error(exc)],
            warnings=[],
            referenced_fragments=[],
        )


@router.post(
    "",
    response_model=FragmentVersionResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_fragment(
    data: FragmentCreate,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new fragment"""
    preset_id = get_active_preset_id(current_user)

    # Resolve folder: folder_id takes priority, then folder_path (creates folders as needed)
    folder_id = _parse_folder_id(data.folder_id)
    if folder_id is None and data.folder_path:
        folder = FolderService.get_or_create_folder_by_path(
            db, current_user.id, preset_id, data.folder_path
        )
        folder_id = folder.id

    existing = fragment_service.get_active_fragment(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        folder_id=folder_id,
        fragment_name=data.fragment_name
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fragment already exists: {data.fragment_name}"
        )

    return fragment_service.save_new_version(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        folder_id=folder_id,
        fragment_name=data.fragment_name,
        content=data.content,
        description=data.description,
        note=data.note
    )


@router.get(
    "/content",
    response_model=FragmentContentResponse
)
async def get_fragment(
    folder_id: Optional[str] = Query(None, description="Folder ID (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get active fragment content"""
    preset_id = get_active_preset_id(current_user)
    result = fragment_service.get_active_fragment(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        folder_id=_parse_folder_id(folder_id),
        fragment_name=fragment_name
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fragment not found: {fragment_name}"
        )

    return result


@router.post(
    "/save",
    response_model=FragmentVersionResponse
)
async def save_fragment(
    data: FragmentUpdate,
    folder_id: Optional[str] = Query(None, description="Folder ID (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save new version of a fragment"""
    preset_id = get_active_preset_id(current_user)
    return fragment_service.save_new_version(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        folder_id=_parse_folder_id(folder_id),
        fragment_name=fragment_name,
        content=data.content,
        description=data.description,
        note=data.note
    )


@router.patch(
    "",
    response_model=FragmentVersionResponse
)
async def update_fragment(
    data: FragmentPatch,
    folder_id: Optional[str] = Query(None, description="Folder ID (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a fragment and optionally rename it."""
    preset_id = get_active_preset_id(current_user)
    try:
        result = fragment_service.update_fragment(
            db=db,
            user_id=current_user.id,
            preset_id=preset_id,
            folder_id=_parse_folder_id(folder_id),
            fragment_name=fragment_name,
            content=data.content,
            description=data.description,
            new_fragment_name=data.fragment_name,
        )
    except FragmentConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fragment not found: {fragment_name}"
        )

    return result


@router.get(
    "/versions",
    response_model=List[FragmentVersionHistoryItem]
)
async def get_version_history(
    folder_id: Optional[str] = Query(None, description="Folder ID (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get version history for a fragment"""
    preset_id = get_active_preset_id(current_user)
    return fragment_service.get_version_history(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        folder_id=_parse_folder_id(folder_id),
        fragment_name=fragment_name
    )


@router.post(
    "/restore",
    status_code=status.HTTP_200_OK
)
async def restore_version(
    data: FragmentRestoreRequest,
    folder_id: Optional[str] = Query(None, description="Folder ID (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Restore a specific version by creating a new version with the restored content"""
    preset_id = get_active_preset_id(current_user)
    result = fragment_service.restore_version(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        folder_id=_parse_folder_id(folder_id),
        fragment_name=fragment_name,
        version_number=data.version_number
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {data.version_number} not found"
        )

    return {
        "success": True,
        "restored_from": data.version_number,
        "new_version": result.version_number
    }


@router.delete(
    "",
    status_code=status.HTTP_200_OK
)
async def delete_fragment(
    folder_id: Optional[str] = Query(None, description="Folder ID (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete all versions of a fragment"""
    preset_id = get_active_preset_id(current_user)
    success = fragment_service.delete_fragment(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        folder_id=_parse_folder_id(folder_id),
        fragment_name=fragment_name
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fragment not found: {fragment_name}"
        )

    return {"success": True}


@router.post(
    "/move",
    status_code=status.HTTP_200_OK
)
async def move_fragment(
    data: FragmentMoveRequest,
    folder_id: Optional[str] = Query(None, description="Current folder ID"),
    fragment_name: str = Query(..., description="Fragment name"),
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Move fragment to a different folder"""
    preset_id = get_active_preset_id(current_user)
    success = fragment_service.move_fragment(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        folder_id=_parse_folder_id(folder_id),
        fragment_name=fragment_name,
        new_folder_id=_parse_folder_id(data.new_folder_id)
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to move fragment. Fragment not found or target already exists."
        )

    return {"success": True, "new_folder_id": data.new_folder_id}


@router.post(
    "/init-defaults",
    status_code=status.HTTP_200_OK
)
async def initialize_default_fragments(
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Initialize default fragments for the current user's active preset.
    Only adds fragments that don't already exist."""
    preset_id = get_active_preset_id(current_user)
    default_seed = load_default_preset_seed()
    added_count = 0
    folder_cache: dict[str, uuid.UUID] = {}

    for item in default_seed.fragments:
        if item.folder_key == "_root":
            folder_id = None
        else:
            folder_id = folder_cache.get(item.folder_key)
            if folder_id is None:
                folder = FolderService.get_or_create_folder_by_path(
                    db, current_user.id, preset_id, item.folder_key
                )
                folder_cache[item.folder_key] = folder.id
                folder_id = folder.id

        existing = fragment_service.get_active_fragment(
            db=db,
            user_id=current_user.id,
            preset_id=preset_id,
            folder_id=folder_id,
            fragment_name=item.fragment_name
        )

        if not existing:
            fragment_service.save_new_version(
                db=db,
                user_id=current_user.id,
                preset_id=preset_id,
                folder_id=folder_id,
                fragment_name=item.fragment_name,
                content=item.content,
                description=item.description,
                note="System default"
            )
            added_count += 1

    return {"success": True, "added_count": added_count, "total_defaults": len(default_seed.fragments)}

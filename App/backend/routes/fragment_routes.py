"""API routes for prompt fragment management"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..schemas.fragments import (
    FragmentContentResponse,
    FragmentCreate,
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
from ..services.fragment_service import fragment_service
from ..prompts import get_default_fragments

router = APIRouter(prefix="/api/v1/fragments", tags=["fragments"])


@router.get(
    "",
    response_model=List[FragmentListItem]
)
async def list_all_fragments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all active fragments for the current user"""
    return fragment_service.get_all_fragments(db=db, user_id=current_user.id)


@router.get(
    "/all",
    response_model=List[FragmentWithContent]
)
async def get_all_fragments_with_content(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all active fragments with content for the template engine"""
    return fragment_service.get_all_fragments_with_content(db=db, user_id=current_user.id)


@router.get(
    "/tree",
    response_model=FragmentTreeResponse
)
async def get_folder_tree(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get folder tree structure with all fragments"""
    return fragment_service.get_folder_tree(db=db, user_id=current_user.id)


@router.post(
    "/validate",
    response_model=FragmentValidationResponse
)
async def validate_fragment(
    data: FragmentValidationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Validate fragment content for syntax errors and circular references.
    This is a simple validation - full Handlebars validation happens on frontend.
    """
    import re

    errors = []
    warnings = []
    referenced_fragments = []

    # Extract {{prompt "path"}} references
    pattern = r'\{\{\s*prompt\s+"([^"]+)"'
    matches = re.findall(pattern, data.content)
    referenced_fragments = list(set(matches))

    # Check if referenced fragments exist
    all_fragments = fragment_service.get_all_fragments(db=db, user_id=current_user.id)
    fragment_paths = set()
    for f in all_fragments:
        path = f"{f.folder_path}/{f.fragment_name}" if f.folder_path else f.fragment_name
        fragment_paths.add(path)

    for ref in referenced_fragments:
        if ref not in fragment_paths:
            warnings.append(f"Referenced fragment not found: {ref}")

    # Basic syntax check for unclosed handlebars
    open_count = data.content.count('{{')
    close_count = data.content.count('}}')
    if open_count != close_count:
        errors.append(f"Mismatched handlebars: {open_count} opening, {close_count} closing")

    return FragmentValidationResponse(
        is_valid=len(errors) == 0,
        syntax_errors=errors,
        warnings=warnings,
        referenced_fragments=referenced_fragments
    )


@router.post(
    "",
    response_model=FragmentVersionResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_fragment(
    data: FragmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new fragment"""
    # Check if fragment already exists
    existing = fragment_service.get_active_fragment(
        db=db,
        user_id=current_user.id,
        folder_path=data.folder_path,
        fragment_name=data.fragment_name
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Fragment already exists: {data.folder_path or ''}/{data.fragment_name}"
        )

    return fragment_service.save_new_version(
        db=db,
        user_id=current_user.id,
        folder_path=data.folder_path,
        fragment_name=data.fragment_name,
        content=data.content,
        description=data.description,
        note=data.note
    )


# Routes with path parameters - using query params to avoid path conflicts
# Since folder_path can have slashes, we use query parameters

@router.get(
    "/content",
    response_model=FragmentContentResponse
)
async def get_fragment(
    folder_path: Optional[str] = Query(None, description="Folder path (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get active fragment content"""
    result = fragment_service.get_active_fragment(
        db=db,
        user_id=current_user.id,
        folder_path=folder_path,
        fragment_name=fragment_name
    )

    if not result:
        path = f"{folder_path}/{fragment_name}" if folder_path else fragment_name
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fragment not found: {path}"
        )

    return result


@router.post(
    "/save",
    response_model=FragmentVersionResponse
)
async def save_fragment(
    data: FragmentUpdate,
    folder_path: Optional[str] = Query(None, description="Folder path (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save new version of a fragment"""
    return fragment_service.save_new_version(
        db=db,
        user_id=current_user.id,
        folder_path=folder_path,
        fragment_name=fragment_name,
        content=data.content,
        description=data.description,
        note=data.note
    )


@router.get(
    "/versions",
    response_model=List[FragmentVersionHistoryItem]
)
async def get_version_history(
    folder_path: Optional[str] = Query(None, description="Folder path (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get version history for a fragment"""
    return fragment_service.get_version_history(
        db=db,
        user_id=current_user.id,
        folder_path=folder_path,
        fragment_name=fragment_name
    )


@router.post(
    "/restore",
    status_code=status.HTTP_200_OK
)
async def restore_version(
    data: FragmentRestoreRequest,
    folder_path: Optional[str] = Query(None, description="Folder path (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Restore a specific version"""
    success = fragment_service.restore_version(
        db=db,
        user_id=current_user.id,
        folder_path=folder_path,
        fragment_name=fragment_name,
        version_number=data.version_number
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {data.version_number} not found"
        )

    return {"success": True, "restored_version": data.version_number}


@router.delete(
    "",
    status_code=status.HTTP_200_OK
)
async def delete_fragment(
    folder_path: Optional[str] = Query(None, description="Folder path (None for root)"),
    fragment_name: str = Query(..., description="Fragment name"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete all versions of a fragment"""
    success = fragment_service.delete_fragment(
        db=db,
        user_id=current_user.id,
        folder_path=folder_path,
        fragment_name=fragment_name
    )

    if not success:
        path = f"{folder_path}/{fragment_name}" if folder_path else fragment_name
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fragment not found: {path}"
        )

    return {"success": True}


@router.post(
    "/move",
    status_code=status.HTTP_200_OK
)
async def move_fragment(
    data: FragmentMoveRequest,
    folder_path: Optional[str] = Query(None, description="Current folder path"),
    fragment_name: str = Query(..., description="Fragment name"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Move fragment to a different folder"""
    success = fragment_service.move_fragment(
        db=db,
        user_id=current_user.id,
        folder_path=folder_path,
        fragment_name=fragment_name,
        new_folder_path=data.new_folder_path
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to move fragment. Fragment not found or target already exists."
        )

    return {"success": True, "new_folder_path": data.new_folder_path}


@router.post(
    "/init-defaults",
    status_code=status.HTTP_200_OK
)
async def initialize_default_fragments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Initialize default fragments for the current user.
    Only adds fragments that don't already exist.
    """
    default_fragments = get_default_fragments()
    added_count = 0

    for path, content in default_fragments.items():
        # Parse path into folder_path and fragment_name
        if '/' in path:
            parts = path.rsplit('/', 1)
            folder_path = parts[0]
            fragment_name = parts[1]
        else:
            folder_path = None
            fragment_name = path

        # Check if fragment already exists
        existing = fragment_service.get_active_fragment(
            db=db,
            user_id=current_user.id,
            folder_path=folder_path,
            fragment_name=fragment_name
        )

        if not existing:
            fragment_service.save_new_version(
                db=db,
                user_id=current_user.id,
                folder_path=folder_path,
                fragment_name=fragment_name,
                content=content,
                description=None,
                note="System default"
            )
            added_count += 1

    return {"success": True, "added_count": added_count, "total_defaults": len(default_fragments)}

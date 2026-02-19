"""Project CRUD routes"""
import os
import zipfile

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from typing import List
import uuid
from datetime import datetime

from ..database import get_db
from ..models.db_models import User, Project, StoryObjectAsset, Asset, BasicInfo, Guidelines
from ..models.translation_models import ObjectVersion
from ..schemas.projects import ProjectCreate, ProjectUpdate, ProjectResponse, ProjectListResponse
from ..schemas.project_transfer import (
    ProjectExportOptions,
    ProjectExportPreviewResponse,
    ProjectExportRequest,
)
from ..auth import get_current_user
from ..services.project_transfer_service import ProjectTransferService
from ..services.deletion_service import (
    collect_project_object_ids,
    delete_object_versions_bulk,
    delete_project_assets_with_files,
    delete_rag_sources_for_project,
)
from ..services.object_change_events import queue_object_change
from ..services.storage_quota_service import StorageQuotaExceededError


def _get_cover_asset(db: Session, project: Project) -> dict | None:
    """Extract cover asset from project's basic_info using StoryObjectAsset"""
    if project.basic_info:
        main_link = db.query(StoryObjectAsset).filter(
            StoryObjectAsset.object_type == 'basic_info',
            StoryObjectAsset.object_id == project.basic_info.id,
            StoryObjectAsset.is_main == True
        ).first()
        if main_link:
            asset = db.query(Asset).filter(Asset.id == main_link.asset_id).first()
            if asset:
                return {
                    "id": str(asset.id),
                    "project_id": str(asset.project_id),
                    "name": asset.name,
                    "file_path": asset.file_path,
                    "mime_type": asset.mime_type,
                    "asset_type": asset.asset_type,
                    "manuscript_id": str(asset.manuscript_id) if asset.manuscript_id is not None else None,
                    "width": asset.width,
                    "height": asset.height,
                    "file_size": asset.file_size,
                    "created_at": asset.created_at,
                    "updated_at": asset.updated_at,
                    "file_url": f"/storage/assets/{asset.file_path}",
                }
    return None


def _project_to_response(db: Session, project: Project) -> dict:
    """Convert project to response dict with cover_asset"""
    return {
        "id": project.id,
        "user_id": project.user_id,
        "name": project.name,
        "description": project.description,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "cover_asset": _get_cover_asset(db, project)
    }

router = APIRouter(prefix="/api/v1/projects", tags=["Projects"])


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new project

    Creates a new story project for the authenticated user.
    Also creates an empty BasicInfo with initial ObjectVersion.
    """
    project_id = uuid.uuid4()
    basic_info_id = uuid.uuid4()
    guidelines_id = uuid.uuid4()
    now = datetime.utcnow()

    # Create project
    new_project = Project(
        id=project_id,
        user_id=current_user.id,
        name=project_data.name,
        description=project_data.description
    )
    db.add(new_project)
    db.flush()  # Flush to get project_id for foreign key

    # Create empty BasicInfo
    basic_info = BasicInfo(
        id=basic_info_id,
        project_id=project_id,
        created_at=now,
        updated_at=now
    )
    db.add(basic_info)

    # Create initial ObjectVersion for BasicInfo
    empty_data = {'title': '', 'logline': '', 'genre': ''}
    version = ObjectVersion(
        id=uuid.uuid4(),
        object_type='basic_info',
        object_id=basic_info_id,
        version_number=1,
        data={project_data.main_language: empty_data},
        user_request='Project Creation',
        created_by=current_user.id,
        created_at=now
    )
    db.add(version)


    # Create empty Guidelines
    guidelines = Guidelines(
        id=guidelines_id,
        project_id=project_id,
        created_at=now,
        updated_at=now
    )
    db.add(guidelines)

    # Create initial ObjectVersion for Guidelines
    guidelines_data = {'authorNote': ''}
    guidelines_version = ObjectVersion(
        id=uuid.uuid4(),
        object_type='guidelines',
        object_id=guidelines_id,
        version_number=1,
        data={project_data.main_language: guidelines_data},
        user_request='Project Creation',
        created_by=current_user.id,
        created_at=now
    )
    db.add(guidelines_version)

    queue_object_change(
        db,
        project_id=project_id,
        object_type="basic_info",
        object_id=basic_info_id,
        action="created",
    )
    queue_object_change(
        db,
        project_id=project_id,
        object_type="guidelines",
        object_id=guidelines_id,
        action="created",
    )

    db.commit()
    db.refresh(new_project)

    return new_project


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    """
    List all projects for the current user

    Returns paginated list of projects owned by the authenticated user.
    Includes cover_asset from BasicInfo if available.
    """
    # Eager load basic_info (cover asset is fetched via StoryObjectAsset in _get_cover_asset)
    projects = db.query(Project).options(
        joinedload(Project.basic_info)
    ).filter(
        Project.user_id == current_user.id
    ).offset(skip).limit(limit).all()

    total = db.query(Project).filter(Project.user_id == current_user.id).count()

    # Convert to response format with cover_asset
    project_responses = [_project_to_response(db, p) for p in projects]

    return {"projects": project_responses, "total": total}


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get a specific project by ID

    Returns project details if the user owns it.
    Includes cover_asset from BasicInfo if available.
    """
    project = db.query(Project).options(
        joinedload(Project.basic_info)
    ).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )

    return _project_to_response(db, project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    project_data: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update a project

    Updates project details (name and/or description).
    """
    project = db.query(Project).options(
        joinedload(Project.basic_info)
    ).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )

    # Update fields if provided
    if project_data.name is not None:
        project.name = project_data.name
    if project_data.description is not None:
        project.description = project_data.description

    db.commit()
    db.refresh(project)

    return _project_to_response(db, project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a project

    Permanently deletes a project and all associated data (cascade delete).
    """
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )

    # Pre-collect IDs for non-FK tables (object_versions) before core rows are cascaded.
    object_ids_by_type = collect_project_object_ids(db, project_id=project_id)

    # Delete project assets (files + rows) to avoid orphan files.
    delete_project_assets_with_files(db, project_id=project_id)

    # Delete RAG sources/chunks for the project (avoid stale search results).
    delete_rag_sources_for_project(db, user_id=current_user.id, project_id=project_id)

    # Delete version history rows for all project objects (object_versions has no FK).
    delete_object_versions_bulk(db, ids_by_type=object_ids_by_type)

    db.delete(project)
    db.commit()

    return None


# ============================================================================
# PROJECT EXPORT / IMPORT (.nbproj)
# ============================================================================


@router.post(
    "/{project_id}/export/preview",
    response_model=ProjectExportPreviewResponse,
)
async def preview_project_export(
    project_id: uuid.UUID,
    options: ProjectExportOptions,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Preview the assets that would be included in a project export."""
    try:
        return ProjectTransferService.build_export_preview(
            db=db,
            user_id=current_user.id,
            project_id=project_id,
            options=options,
        )
    except ValueError as e:
        message = str(e)
        if message == "Project not found":
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)


@router.post(
    "/{project_id}/export",
    response_class=FileResponse,
)
async def export_project(
    project_id: uuid.UUID,
    request: ProjectExportRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export a project as a .nbproj archive."""
    try:
        tmp_path, filename = ProjectTransferService.export_project_to_nbproj(
            db=db,
            user_id=current_user.id,
            project_id=project_id,
            options=request.options,
            manual_asset_ids=request.asset_ids,
        )
    except ValueError as e:
        message = str(e)
        if message == "Project not found":
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)

    def _cleanup() -> None:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass

    background_tasks.add_task(_cleanup)
    return FileResponse(
        path=tmp_path,
        media_type="application/octet-stream",
        filename=filename,
        background=background_tasks,
    )


@router.post(
    "/import",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_project(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import a project from a .nbproj archive (creates a new project)."""
    filename = file.filename or ""
    if filename and not filename.lower().endswith(".nbproj"):
        raise HTTPException(status_code=400, detail="Invalid file type. Expected .nbproj")

    try:
        data = await file.read()
        new_project_id = ProjectTransferService.import_nbproj(db=db, user_id=current_user.id, nbproj_bytes=data)
    except StorageQuotaExceededError:
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid .nbproj file (bad zip)")
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Invalid .nbproj structure: missing {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    project = db.query(Project).options(joinedload(Project.basic_info)).filter(
        Project.id == new_project_id,
        Project.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=500, detail="Import succeeded but project not found")

    return _project_to_response(db, project)

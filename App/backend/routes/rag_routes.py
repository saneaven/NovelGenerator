from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import (
    User,
    Project,
    UserSettings,
    BasicInfo,
    Guidelines,
    Character,
    Organization,
    Location,
    LorebookEntry,
    Outline,
    Act,
    Chapter,
    Manuscript,
)
from ..schemas.rag import (
    RagEmbeddingProfileResponse,
    RagProjectStatusResponse,
    RagIndexObjectRequest,
    RagDeleteObjectRequest,
    RagReindexRequest,
    RagReindexResponse,
    RagSearchRequest,
    RagSearchResponse,
    RagSearchResult,
)
from ..services.embedding_config_service import get_embedding_profile
from ..services.rag_index_service import (
    delete_object_index,
    get_project_status,
    index_object,
    reindex_project,
)
from ..services.rag_search_service import search_project


router = APIRouter(prefix="/api/v1", tags=["rag"])


def _is_rag_enabled(db: Session, *, user_id: UUID) -> bool:
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    return bool(getattr(settings, "rag_search_enabled", False)) if settings else False


def _require_rag_enabled(db: Session, *, user_id: UUID) -> None:
    if not _is_rag_enabled(db, user_id=user_id):
        raise HTTPException(status_code=400, detail="Embeddings are disabled (Settings > RAG Search)")


def _get_project_or_404(db: Session, *, user_id: UUID, project_id: UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _ensure_object_in_project(db: Session, *, project_id: UUID, object_type: str, object_id: UUID) -> None:
    ok = False
    if object_type == "basic_info":
        ok = db.query(BasicInfo).filter(BasicInfo.id == object_id, BasicInfo.project_id == project_id).first() is not None
    elif object_type == "guidelines":
        ok = db.query(Guidelines).filter(Guidelines.id == object_id, Guidelines.project_id == project_id).first() is not None
    elif object_type == "character":
        ok = db.query(Character).filter(Character.id == object_id, Character.project_id == project_id).first() is not None
    elif object_type == "organization":
        ok = db.query(Organization).filter(Organization.id == object_id, Organization.project_id == project_id).first() is not None
    elif object_type == "location":
        ok = db.query(Location).filter(Location.id == object_id, Location.project_id == project_id).first() is not None
    elif object_type == "lorebook":
        ok = db.query(LorebookEntry).filter(LorebookEntry.id == object_id, LorebookEntry.project_id == project_id).first() is not None
    elif object_type == "outline":
        ok = db.query(Outline).filter(Outline.id == object_id, Outline.project_id == project_id).first() is not None
    elif object_type == "act":
        ok = (
            db.query(Act)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Act.id == object_id, Outline.project_id == project_id)
            .first()
            is not None
        )
    elif object_type == "chapter":
        ok = (
            db.query(Chapter)
            .join(Act, Act.id == Chapter.act_id)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Chapter.id == object_id, Outline.project_id == project_id)
            .first()
            is not None
        )
    elif object_type == "manuscript":
        ok = (
            db.query(Manuscript)
            .join(Chapter, Chapter.id == Manuscript.chapter_id)
            .join(Act, Act.id == Chapter.act_id)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Manuscript.id == object_id, Outline.project_id == project_id)
            .first()
            is not None
        )

    if not ok:
        raise HTTPException(status_code=404, detail="Object not found in project")


@router.get("/projects/{project_id}/rag/status", response_model=RagProjectStatusResponse)
async def get_rag_status(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, user_id=current_user.id, project_id=project_id)
    enabled = _is_rag_enabled(db, user_id=current_user.id)
    status_data = get_project_status(db, user_id=current_user.id, project_id=project_id)
    status_data["enabled"] = enabled
    return RagProjectStatusResponse(**status_data)


@router.post("/projects/{project_id}/rag/index-object")
async def rag_index_object(
    project_id: UUID,
    request: RagIndexObjectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, user_id=current_user.id, project_id=project_id)
    _require_rag_enabled(db, user_id=current_user.id)
    _ensure_object_in_project(db, project_id=project_id, object_type=request.object_type, object_id=request.object_id)

    profile = get_embedding_profile(db, user_id=current_user.id, feature="ragSearch")
    if not profile:
        raise HTTPException(status_code=400, detail="RAG embedding profile is not configured")

    cfg: Dict[str, Any] = request.config.model_dump()

    try:
        result = await index_object(
            db,
            user_id=current_user.id,
            project_id=project_id,
            object_type=request.object_type,
            object_id=request.object_id,
            provider_config=cfg,
            force=request.force,
        )
        return {"status": "ok", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/rag/delete-object")
async def rag_delete_object(
    project_id: UUID,
    request: RagDeleteObjectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, user_id=current_user.id, project_id=project_id)
    _require_rag_enabled(db, user_id=current_user.id)
    deleted = delete_object_index(
        db,
        user_id=current_user.id,
        project_id=project_id,
        object_type=request.object_type,
        object_id=request.object_id,
    )
    return {"status": "ok", "deleted_sources": deleted}


@router.post("/projects/{project_id}/rag/reindex", response_model=RagReindexResponse)
async def rag_reindex_project(
    project_id: UUID,
    request: RagReindexRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, user_id=current_user.id, project_id=project_id)
    _require_rag_enabled(db, user_id=current_user.id)

    profile = get_embedding_profile(db, user_id=current_user.id, feature="ragSearch")
    if not profile:
        raise HTTPException(status_code=400, detail="RAG embedding profile is not configured")

    cfg: Dict[str, Any] = request.config.model_dump()

    try:
        summary = await reindex_project(
            db,
            user_id=current_user.id,
            project_id=project_id,
            provider_config=cfg,
            force=request.force,
        )
        return RagReindexResponse(**summary)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/rag/search", response_model=RagSearchResponse)
async def rag_search(
    project_id: UUID,
    request: RagSearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, user_id=current_user.id, project_id=project_id)
    _require_rag_enabled(db, user_id=current_user.id)

    profile = get_embedding_profile(db, user_id=current_user.id, feature="ragSearch")
    if not profile:
        raise HTTPException(status_code=400, detail="RAG embedding profile is not configured")

    cfg: Dict[str, Any] = request.config.model_dump()

    try:
        results = await search_project(
            db,
            user_id=current_user.id,
            project_id=project_id,
            queries=request.queries,
            provider_config=cfg,
            top_k_per_query=request.top_k_per_query,
            neighbor_window=request.neighbor_window,
        )
        return RagSearchResponse(results=[RagSearchResult(**r) for r in results])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

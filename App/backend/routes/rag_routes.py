from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User, UserSettings
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
    RagKeywordSearchResponse,
)
from ..services.embedding_config_service import get_embedding_profile
from ..services.credential_service import CredentialServiceError, credential_service
from ..services.ownership import require_owned_object, require_owned_project
from ..services.rag_index_service import (
    delete_object_index,
    get_project_status,
    index_object,
    reindex_project,
)
from ..services.rag_search_service import keyword_search_project, search_project


router = APIRouter(prefix="/api/v1", tags=["rag"])


def _is_rag_enabled(db: Session, *, user_id: UUID) -> bool:
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    return bool(getattr(settings, "rag_search_enabled", False)) if settings else False


def _require_rag_enabled(db: Session, *, user_id: UUID) -> None:
    if not _is_rag_enabled(db, user_id=user_id):
        raise HTTPException(status_code=400, detail="Embeddings are disabled (Settings > Search & Memory)")

@router.get("/projects/{project_id}/rag/status", response_model=RagProjectStatusResponse)
async def get_rag_status(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
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
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    _require_rag_enabled(db, user_id=current_user.id)
    require_owned_object(
        db,
        user_id=current_user.id,
        object_type=request.object_type,
        object_id=request.object_id,
        project_id=project_id,
    )

    profile = get_embedding_profile(db, user_id=current_user.id, feature="ragSearch")
    if not profile:
        raise HTTPException(status_code=400, detail="RAG embedding profile is not configured")

    try:
        cfg: Dict[str, Any] = credential_service.get_provider_config(db, current_user.id, profile["provider"])
    except CredentialServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

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
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
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
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    _require_rag_enabled(db, user_id=current_user.id)

    profile = get_embedding_profile(db, user_id=current_user.id, feature="ragSearch")
    if not profile:
        raise HTTPException(status_code=400, detail="RAG embedding profile is not configured")

    try:
        cfg: Dict[str, Any] = credential_service.get_provider_config(db, current_user.id, profile["provider"])
    except CredentialServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

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
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    _require_rag_enabled(db, user_id=current_user.id)

    profile = get_embedding_profile(db, user_id=current_user.id, feature="ragSearch")
    if not profile:
        raise HTTPException(status_code=400, detail="RAG embedding profile is not configured")

    try:
        cfg: Dict[str, Any] = credential_service.get_provider_config(db, current_user.id, profile["provider"])
    except CredentialServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

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


@router.get("/projects/{project_id}/rag/keyword-search", response_model=RagKeywordSearchResponse)
async def rag_keyword_search(
    project_id: UUID,
    keyword: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    _require_rag_enabled(db, user_id=current_user.id)

    kw = (keyword or "").strip()
    if not kw:
        raise HTTPException(status_code=400, detail="Keyword must not be empty")

    settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    raw_page_size = getattr(settings, "rag_search_keyword_page_size", 20) if settings else 20
    try:
        page_size = int(raw_page_size)
    except Exception:
        page_size = 20
    page_size = max(1, min(200, page_size))

    try:
        data = keyword_search_project(
            db,
            user_id=current_user.id,
            project_id=project_id,
            keyword=kw,
            page=page,
            page_size=page_size,
        )
        return RagKeywordSearchResponse(
            keyword=kw,
            page=page,
            page_size=page_size,
            total=int(data.get("total") or 0),
            results=[RagSearchResult(**r) for r in (data.get("results") or [])],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

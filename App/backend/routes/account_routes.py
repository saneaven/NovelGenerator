"""Account endpoints (current user)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import Asset, Project, User
from ..schemas.account_storage import AccountStorageResponse, ProjectStorageBreakdown
from ..services.storage_quota_service import get_user_asset_used_bytes, resolve_user_asset_quota_bytes


router = APIRouter(prefix="/api/v1/account", tags=["account"])


@router.get("/storage", response_model=AccountStorageResponse)
async def get_account_storage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    quota_bytes = resolve_user_asset_quota_bytes(current_user)
    used_bytes = get_user_asset_used_bytes(db, user_id=current_user.id)
    remaining_bytes = max(int(quota_bytes) - int(used_bytes), 0)
    percent_used = 0.0 if quota_bytes <= 0 else min(float(used_bytes) / float(quota_bytes), 1.0)

    size_expr = func.coalesce(Asset.file_size, 0)
    rows = (
        db.query(
            Project.id,
            Project.name,
            func.count(Asset.id).label("asset_count"),
            func.coalesce(func.sum(size_expr), 0).label("used_bytes"),
        )
        .outerjoin(Asset, Asset.project_id == Project.id)
        .filter(Project.user_id == current_user.id)
        .group_by(Project.id)
        .order_by(Project.updated_at.desc())
        .all()
    )

    by_project = [
        ProjectStorageBreakdown(
            project_id=str(project_id),
            project_name=str(project_name or ""),
            asset_count=int(asset_count or 0),
            used_bytes=int(project_used_bytes or 0),
        )
        for project_id, project_name, asset_count, project_used_bytes in rows
        if isinstance(project_id, UUID)
    ]

    return AccountStorageResponse(
        user_id=str(current_user.id),
        used_bytes=int(used_bytes),
        quota_bytes=int(quota_bytes),
        remaining_bytes=int(remaining_bytes),
        percent_used=float(percent_used),
        by_project=by_project,
        computed_at=datetime.utcnow(),
    )

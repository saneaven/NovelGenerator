"""Account endpoints (current user)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import Asset, Project, ProjectStorageUsage, User
from ..schemas.storage_usage import AccountStorageResponse, ProjectStorageBreakdown, StorageCategoryBreakdown
from ..services.storage_usage_service import get_user_used_bytes, resolve_user_storage_quota_bytes


router = APIRouter(prefix="/api/v1/account", tags=["account"])


@router.get("/storage", response_model=AccountStorageResponse)
async def get_account_storage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    quota_bytes = resolve_user_storage_quota_bytes(current_user)
    used_bytes = get_user_used_bytes(db, user_id=current_user.id)
    remaining_bytes = max(int(quota_bytes) - int(used_bytes), 0)
    percent_used = 0.0 if quota_bytes <= 0 else min(float(used_bytes) / float(quota_bytes), 1.0)

    image_count_subq = (
        db.query(
            Asset.project_id.label("project_id"),
            func.count(Asset.id).label("image_count"),
        )
        .group_by(Asset.project_id)
        .subquery()
    )
    rows = (
        db.query(
            Project.id,
            Project.name,
            func.coalesce(image_count_subq.c.image_count, 0).label("image_count"),
            func.coalesce(ProjectStorageUsage.project_meta_bytes, 0).label("project_meta_bytes"),
            func.coalesce(ProjectStorageUsage.story_bytes, 0).label("story_bytes"),
            func.coalesce(ProjectStorageUsage.manuscript_bytes, 0).label("manuscript_bytes"),
            func.coalesce(ProjectStorageUsage.chat_bytes, 0).label("chat_bytes"),
            func.coalesce(ProjectStorageUsage.notification_bytes, 0).label("notification_bytes"),
            func.coalesce(ProjectStorageUsage.image_run_bytes, 0).label("image_run_bytes"),
            func.coalesce(ProjectStorageUsage.image_bytes, 0).label("image_bytes"),
            func.coalesce(ProjectStorageUsage.total_bytes, 0).label("used_bytes"),
        )
        .outerjoin(ProjectStorageUsage, ProjectStorageUsage.project_id == Project.id)
        .outerjoin(image_count_subq, image_count_subq.c.project_id == Project.id)
        .filter(Project.user_id == current_user.id)
        .order_by(Project.updated_at.desc())
        .all()
    )

    by_project = [
        ProjectStorageBreakdown(
            project_id=str(project_id),
            project_name=str(project_name or ""),
            image_count=int(image_count or 0),
            used_bytes=int(project_used_bytes or 0),
            categories=StorageCategoryBreakdown(
                project_meta_bytes=int(project_meta_bytes or 0),
                story_bytes=int(story_bytes or 0),
                manuscript_bytes=int(manuscript_bytes or 0),
                chat_bytes=int(chat_bytes or 0),
                notification_bytes=int(notification_bytes or 0),
                image_run_bytes=int(image_run_bytes or 0),
                image_bytes=int(image_bytes or 0),
                total_bytes=int(project_used_bytes or 0),
            ),
        )
        for (
            project_id,
            project_name,
            image_count,
            project_meta_bytes,
            story_bytes,
            manuscript_bytes,
            chat_bytes,
            notification_bytes,
            image_run_bytes,
            image_bytes,
            project_used_bytes,
        ) in rows
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

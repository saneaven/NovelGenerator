"""Admin endpoints."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..database import SessionLocal, get_db
from ..models.db_models import ProjectStorageUsage, User
from ..schemas.admin import (
    AdminStorageReconcileProjectResult,
    AdminStorageReconcileRequest,
    AdminStorageReconcileResponse,
    AdminUserStorageItem,
    AdminUsersStorageResponse,
    AdminUserUpdateRequest,
)
from ..services.storage_usage_service import resolve_user_storage_quota_bytes, run_storage_usage_reconcile_batch


router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/users/storage", response_model=AdminUsersStorageResponse)
async def list_users_storage(
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    usage_subq = (
        db.query(
            ProjectStorageUsage.user_id.label("user_id"),
            func.coalesce(func.sum(ProjectStorageUsage.total_bytes), 0).label("used_bytes"),
        )
        .group_by(ProjectStorageUsage.user_id)
        .subquery()
    )

    rows = (
        db.query(
            User,
            func.coalesce(usage_subq.c.used_bytes, 0).label("used_bytes"),
        )
        .outerjoin(usage_subq, usage_subq.c.user_id == User.id)
        .order_by(User.created_at.desc())
        .all()
    )

    items: list[AdminUserStorageItem] = []
    for user, used_bytes in rows:
        quota_bytes = resolve_user_storage_quota_bytes(user)
        remaining_bytes = max(int(quota_bytes) - int(used_bytes or 0), 0)
        percent_used = 0.0 if quota_bytes <= 0 else min(float(used_bytes or 0) / float(quota_bytes), 1.0)

        override = getattr(user, "storage_quota_bytes", None)
        override_out = int(override) if isinstance(override, int) else None

        items.append(
            AdminUserStorageItem(
                user_id=str(user.id),
                email=str(user.email),
                username=str(user.username),
                is_admin=bool(getattr(user, "is_admin", False)),
                used_bytes=int(used_bytes or 0),
                quota_bytes=int(quota_bytes),
                remaining_bytes=int(remaining_bytes),
                percent_used=float(percent_used),
                storage_quota_bytes_override=override_out,
                created_at=user.created_at,
            )
        )

    return AdminUsersStorageResponse(
        users=items,
        total=len(items),
        computed_at=datetime.utcnow(),
    )


@router.patch("/users/{user_id}", response_model=AdminUserStorageItem)
async def update_user_admin_fields(
    user_id: UUID,
    request: AdminUserUpdateRequest,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    fields = request.model_fields_set

    if "is_admin" in fields:
        if request.is_admin is None:
            raise HTTPException(status_code=400, detail="is_admin must be true/false")

        if user.id == current_admin.id and request.is_admin is False:
            raise HTTPException(status_code=400, detail="You cannot revoke your own admin role")

        if user.is_admin and request.is_admin is False:
            admin_count = db.query(func.count(User.id)).filter(User.is_admin == True).scalar()  # noqa: E712
            if int(admin_count or 0) <= 1:
                raise HTTPException(status_code=400, detail="Cannot revoke the last admin")

        user.is_admin = bool(request.is_admin)

    if "storage_quota_bytes" in fields:
        user.storage_quota_bytes = request.storage_quota_bytes

    db.commit()
    db.refresh(user)

    used_bytes = (
        db.query(func.coalesce(func.sum(ProjectStorageUsage.total_bytes), 0))
        .filter(ProjectStorageUsage.user_id == user.id)
        .scalar()
    )
    used_bytes_int = int(used_bytes or 0)

    quota_bytes = resolve_user_storage_quota_bytes(user)
    remaining_bytes = max(int(quota_bytes) - used_bytes_int, 0)
    percent_used = 0.0 if quota_bytes <= 0 else min(float(used_bytes_int) / float(quota_bytes), 1.0)

    override = getattr(user, "storage_quota_bytes", None)
    override_out = int(override) if isinstance(override, int) else None

    return AdminUserStorageItem(
        user_id=str(user.id),
        email=str(user.email),
        username=str(user.username),
        is_admin=bool(user.is_admin),
        used_bytes=used_bytes_int,
        quota_bytes=int(quota_bytes),
        remaining_bytes=int(remaining_bytes),
        percent_used=float(percent_used),
        storage_quota_bytes_override=override_out,
        created_at=user.created_at,
    )


@router.post("/storage/reconcile", response_model=AdminStorageReconcileResponse)
async def reconcile_storage_usage(
    request: AdminStorageReconcileRequest,
    current_admin: User = Depends(require_admin),
):
    _ = current_admin

    try:
        resolved_user_id = UUID(request.user_id) if request.user_id else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid user_id") from exc
    try:
        resolved_project_id = UUID(request.project_id) if request.project_id else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid project_id") from exc

    result = run_storage_usage_reconcile_batch(
        session_factory=SessionLocal,
        scope=request.scope,
        apply=request.apply,
        limit=request.limit,
        user_id=resolved_user_id,
        project_id=resolved_project_id,
    )

    return AdminStorageReconcileResponse(
        scope=result.scope,
        applied=result.applied,
        scanned_projects=result.scanned_projects,
        reconciled_projects=result.reconciled_projects,
        drifted_projects=result.drifted_projects,
        failed_projects=result.failed_projects,
        results=[
            AdminStorageReconcileProjectResult(
                project_id=str(item.project_id),
                before_total_bytes=int(item.before.total_bytes),
                after_total_bytes=int(item.after.total_bytes),
                drift_bytes=int(item.drift_bytes),
                needs_reconcile_after=bool(item.needs_reconcile_after),
                status=item.status,
                error=item.error,
            )
            for item in result.results
        ],
    )

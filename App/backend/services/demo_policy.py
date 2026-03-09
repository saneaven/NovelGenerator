from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from .settings_service import settings_service


def is_demo_mode_enabled(db: Session, user_id) -> bool:
    settings = settings_service.get_or_create_settings(db, user_id)
    return bool(getattr(settings, "demo_mode_enabled", False))


async def require_demo_off(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if is_demo_mode_enabled(db, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo mode must be disabled before editing this setting",
        )

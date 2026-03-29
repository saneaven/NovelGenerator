"""Server-side encrypted credential routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..provider_engine.runtime_dispatch import normalize_credentials
from ..services.credential_service import CredentialServiceError, credential_service
from ..services.demo_policy import require_demo_off


router = APIRouter(prefix="/api/v1/credentials", tags=["credentials"])


class CredentialUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config: dict[str, Any] = Field(default_factory=dict)


class ProvidersResponse(BaseModel):
    providers: list[str]


@router.put("/{provider}")
async def put_credential(
    provider: str,
    payload: CredentialUpsertRequest,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        normalized = normalize_credentials(provider, payload.config)
        credential_service.save_credential(db, current_user.id, provider, normalized)
        db.commit()
    except CredentialServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"ok": True}


@router.get("", response_model=ProvidersResponse)
async def list_credentials(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return ProvidersResponse(providers=credential_service.list_providers(db, current_user.id))


@router.delete("/{provider}")
async def delete_credential(
    provider: str,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deleted = credential_service.delete_credential(db, current_user.id, provider)
    db.commit()
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found")
    return {"ok": True}

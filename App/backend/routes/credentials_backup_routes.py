"""E2E credentials backup routes.

Stores and returns an opaque encrypted blob produced by the client.
The server verifies the user's password for sensitive actions (upload/download/delete)
but never decrypts API keys.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user, verify_password
from ..database import get_db
from ..models.db_models import User, UserCredentials
from ..schemas.credentials_backup import (
    CredentialBackupBlobResponse,
    CredentialBackupPasswordRequest,
    CredentialBackupStatusResponse,
    CredentialBackupUpsertRequest,
)


router = APIRouter(prefix="/api/v1/credentials-backup", tags=["credentials-backup"])


def _verify_user_password_or_401(password: str, current_user: User) -> None:
    if not verify_password(password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )


@router.get("/status", response_model=CredentialBackupStatusResponse)
async def get_backup_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserCredentials).filter(UserCredentials.user_id == current_user.id).first()
    if not row:
        return CredentialBackupStatusResponse(hasBackup=False, updatedAt=None)
    return CredentialBackupStatusResponse(hasBackup=True, updatedAt=row.updated_at.isoformat())


@router.put("/blob", response_model=CredentialBackupStatusResponse)
async def upsert_backup_blob(
    payload: CredentialBackupUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _verify_user_password_or_401(payload.password, current_user)

    row = db.query(UserCredentials).filter(UserCredentials.user_id == current_user.id).first()
    if row:
        row.credentials_blob = payload.blob
    else:
        row = UserCredentials(user_id=current_user.id, credentials_blob=payload.blob)
        db.add(row)

    db.commit()
    db.refresh(row)
    return CredentialBackupStatusResponse(hasBackup=True, updatedAt=row.updated_at.isoformat())


@router.post("/blob", response_model=CredentialBackupBlobResponse)
async def get_backup_blob(
    payload: CredentialBackupPasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _verify_user_password_or_401(payload.password, current_user)

    row = db.query(UserCredentials).filter(UserCredentials.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No backup found")

    return CredentialBackupBlobResponse(blob=row.credentials_blob, updatedAt=row.updated_at.isoformat())


@router.post("/delete", response_model=CredentialBackupStatusResponse)
async def delete_backup_blob(
    payload: CredentialBackupPasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _verify_user_password_or_401(payload.password, current_user)

    row = db.query(UserCredentials).filter(UserCredentials.user_id == current_user.id).first()
    if row:
        db.delete(row)
        db.commit()
    return CredentialBackupStatusResponse(hasBackup=False, updatedAt=None)


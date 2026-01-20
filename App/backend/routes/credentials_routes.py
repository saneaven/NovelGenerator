"""API routes for encrypted credential vault (provider API keys).

This API never returns plaintext credentials.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User, UserCredentials
from ..schemas.credentials import CredentialVaultStatusResponse
from ..schemas.settings import ProviderCredentials
from ..services.credential_vault_service import (
    CredentialVaultError,
    compute_has_key_by_provider,
    decrypt_json,
    encrypt_json,
)


router = APIRouter(prefix="/api/v1/credentials", tags=["credentials"])


def _vault_not_configured_response() -> CredentialVaultStatusResponse:
    return CredentialVaultStatusResponse(hasKeyByProvider={}, updatedAt=None, vaultConfigured=False)


@router.get("/status", response_model=CredentialVaultStatusResponse)
async def get_credential_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserCredentials).filter(UserCredentials.user_id == current_user.id).first()
    if not row:
        return _vault_not_configured_response() if _vault_is_not_configured() else CredentialVaultStatusResponse(hasKeyByProvider={}, updatedAt=None, vaultConfigured=True)

    try:
        data = decrypt_json(row.provider_credentials_enc)
        return CredentialVaultStatusResponse(
            hasKeyByProvider=compute_has_key_by_provider(data),
            updatedAt=row.updated_at.isoformat(),
            vaultConfigured=True,
        )
    except CredentialVaultError:
        # Key rotated or invalid token; do not leak details.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Stored credentials cannot be decrypted with the current server key. Delete and re-save credentials.",
        )


@router.put("", response_model=CredentialVaultStatusResponse)
async def upsert_credentials(
    credentials: ProviderCredentials,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        token = encrypt_json(credentials.model_dump())
    except CredentialVaultError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Credential vault is not configured on the server.",
        )

    row = db.query(UserCredentials).filter(UserCredentials.user_id == current_user.id).first()
    if row:
        row.provider_credentials_enc = token
    else:
        row = UserCredentials(user_id=current_user.id, provider_credentials_enc=token)
        db.add(row)

    db.commit()
    db.refresh(row)

    return CredentialVaultStatusResponse(
        hasKeyByProvider=compute_has_key_by_provider(credentials.model_dump()),
        updatedAt=row.updated_at.isoformat(),
        vaultConfigured=True,
    )


@router.delete("", response_model=CredentialVaultStatusResponse)
async def delete_credentials(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserCredentials).filter(UserCredentials.user_id == current_user.id).first()
    if row:
        db.delete(row)
        db.commit()
    return _vault_not_configured_response() if _vault_is_not_configured() else CredentialVaultStatusResponse(hasKeyByProvider={}, updatedAt=None, vaultConfigured=True)


def _vault_is_not_configured() -> bool:
    try:
        # Try importing and calling encrypt_json with a trivial payload to validate config
        encrypt_json({})
        return False
    except CredentialVaultError:
        return True


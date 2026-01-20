"""OpenRouter proxy routes.

Used to avoid exposing the OpenRouter API key in the browser when using server vault mode.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import httpx

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..services.credential_resolver import CredentialVaultError, resolve_provider_config


router = APIRouter(prefix="/api/v1/openrouter", tags=["openrouter"])


@router.get("/models/{canonical_slug}/endpoints")
async def get_model_endpoints(
    canonical_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        resolved = resolve_provider_config(
            provider="openrouter",
            request_config={},
            current_user=current_user,
            db=db,
        )
    except CredentialVaultError as e:
        msg = str(e)
        if "cannot be decrypted" in msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Stored credentials cannot be decrypted with the current server key. Delete and re-save credentials.",
            )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Credential vault is not configured on the server.",
        )

    api_key = resolved.get("api_key")
    if not (isinstance(api_key, str) and api_key.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OpenRouter API key is not configured.",
        )

    url = f"https://openrouter.ai/api/v1/models/{canonical_slug}/endpoints"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(url, headers=headers)

    if res.status_code >= 400:
        raise HTTPException(status_code=res.status_code, detail=res.text)

    return res.json()


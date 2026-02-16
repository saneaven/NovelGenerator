"""API routes for token counting."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Literal

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..services.credential_service import CredentialServiceError, credential_service
from ..services.token_counting_service import count_tokens_claude, count_tokens_gemini

router = APIRouter(prefix="/api/v1/tokens", tags=["tokens"])


class CountTokensRequest(BaseModel):
    """Request body for token counting."""
    provider: Literal["claude", "gemini"]
    model: str
    text: str


class CountTokensResponse(BaseModel):
    """Response body for token counting."""
    token_count: int
    provider: str
    model: str


@router.post("/count", response_model=CountTokensResponse)
async def count_tokens(
    request: CountTokensRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Count tokens for the given text using the specified provider.

    Supported providers:
    - claude: Uses Anthropic's count_tokens API
    - gemini: Uses Google's countTokens API
    """
    try:
        config = credential_service.get_provider_config(db, current_user.id, request.provider)
    except CredentialServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    api_key = str(config.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail=f"Credential for provider '{request.provider}' not found")

    # SSRF hardening: token counting only supports official endpoints (no user-supplied base_url).
    base_url = None

    try:
        if request.provider == "claude":
            token_count = await count_tokens_claude(
                text=request.text,
                model=request.model,
                api_key=api_key,
                base_url=base_url,
            )
        elif request.provider == "gemini":
            token_count = await count_tokens_gemini(
                text=request.text,
                model=request.model,
                api_key=api_key,
                base_url=base_url,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported provider: {request.provider}",
            )

        return CountTokensResponse(
            token_count=token_count,
            provider=request.provider,
            model=request.model,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Token counting failed: {str(e)}",
        )

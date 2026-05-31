"""API routes for token counting."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Literal

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..services.token_count_service import count_text_tokens

router = APIRouter(prefix="/api/v1/tokens", tags=["tokens"])


class CountTokensRequest(BaseModel):
    """Request body for token counting."""
    provider: str
    model: str
    text: str
    tokenizer_override: Literal["openai", "claude", "gemini"] | None = None
    variant_hint: str | None = None


class CountTokensResponse(BaseModel):
    """Response body for token counting."""
    token_count: int
    provider: str
    model: str
    effective_tokenizer: str
    is_estimate: bool
    fallback_used: bool
    method: Literal["tiktoken", "claude_api", "gemini_api"]


@router.post("/count", response_model=CountTokensResponse)
async def count_tokens(
    request: CountTokensRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Count tokens using the same backend policy as runtime pipeline."""
    try:
        result = await count_text_tokens(
            db,
            user_id=current_user.id,
            provider=request.provider,
            model=request.model,
            text=request.text,
            tokenizer_override=request.tokenizer_override,
            variant_hint=request.variant_hint,
            # SSRF hardening for route-level counting.
            allow_custom_base_url=False,
        )
        return CountTokensResponse(
            token_count=result.token_count,
            provider=result.provider,
            model=result.model,
            effective_tokenizer=result.effective_tokenizer,
            is_estimate=result.is_estimate,
            fallback_used=result.fallback_used,
            method=result.method,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Token counting request is invalid: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Token counting failed: {str(e)}",
        )

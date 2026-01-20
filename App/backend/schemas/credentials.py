"""Pydantic schemas for encrypted credential vault APIs."""

from pydantic import BaseModel, Field
from typing import Dict, Optional


class CredentialVaultStatusResponse(BaseModel):
    """Status response for stored credentials (never returns plaintext)."""

    hasKeyByProvider: Dict[str, bool] = Field(default_factory=dict)
    updatedAt: Optional[str] = None
    vaultConfigured: bool = True


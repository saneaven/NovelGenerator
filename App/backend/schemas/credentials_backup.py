"""Pydantic schemas for E2E credentials backup APIs.

The server stores and returns an opaque encrypted blob.
It never decrypts provider API keys.
"""

from pydantic import BaseModel, Field
from typing import Optional


class CredentialBackupStatusResponse(BaseModel):
    """Status of server-side backup for current user."""

    hasBackup: bool = False
    updatedAt: Optional[str] = None


class CredentialBackupUpsertRequest(BaseModel):
    """Upload an encrypted blob (client-side E2E encrypted)."""

    password: str = Field(min_length=1)
    blob: str = Field(min_length=1)


class CredentialBackupPasswordRequest(BaseModel):
    """Password confirmation for sensitive backup actions (download/delete)."""

    password: str = Field(min_length=1)


class CredentialBackupBlobResponse(BaseModel):
    """Download encrypted blob (still encrypted)."""

    blob: str
    updatedAt: str


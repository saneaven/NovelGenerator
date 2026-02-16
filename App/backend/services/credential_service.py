"""Server-side credential encryption service."""

from __future__ import annotations

import json
import os
from typing import Any
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from ..models.db_models import ServerCredential


class CredentialServiceError(RuntimeError):
    """Credential service exception."""


class CredentialService:
    def __init__(self) -> None:
        self._fernet: Fernet | None = None

    def _get_fernet(self) -> Fernet:
        if self._fernet is not None:
            return self._fernet
        key = os.getenv("CREDENTIAL_ENCRYPTION_KEY")
        if not key:
            raise CredentialServiceError("CREDENTIAL_ENCRYPTION_KEY must be set")
        self._fernet = Fernet(key.encode("utf-8"))
        return self._fernet

    def _encrypt(self, config: dict[str, Any]) -> str:
        payload = json.dumps(config, separators=(",", ":"), ensure_ascii=False)
        token = self._get_fernet().encrypt(payload.encode("utf-8"))
        return token.decode("utf-8")

    def _decrypt(self, encrypted: str) -> dict[str, Any]:
        try:
            plain = self._get_fernet().decrypt(encrypted.encode("utf-8"))
        except InvalidToken as exc:
            raise CredentialServiceError("Failed to decrypt credential payload") from exc
        try:
            obj = json.loads(plain.decode("utf-8"))
        except ValueError as exc:
            raise CredentialServiceError("Credential payload is not valid JSON") from exc
        if not isinstance(obj, dict):
            raise CredentialServiceError("Credential payload must be an object")
        return obj

    def save_credential(self, db: Session, user_id: UUID, provider: str, config_dict: dict[str, Any]) -> None:
        provider_name = provider.strip()
        if not provider_name:
            raise CredentialServiceError("provider is required")

        row = (
            db.query(ServerCredential)
            .filter(ServerCredential.user_id == user_id, ServerCredential.provider == provider_name)
            .first()
        )
        encrypted = self._encrypt(config_dict)
        if row:
            row.encrypted_config = encrypted
        else:
            db.add(
                ServerCredential(
                    user_id=user_id,
                    provider=provider_name,
                    encrypted_config=encrypted,
                )
            )

    def get_credential(self, db: Session, user_id: UUID, provider: str) -> dict[str, Any] | None:
        provider_name = provider.strip()
        row = (
            db.query(ServerCredential)
            .filter(ServerCredential.user_id == user_id, ServerCredential.provider == provider_name)
            .first()
        )
        if not row:
            return None
        return self._decrypt(row.encrypted_config)

    def get_provider_config(self, db: Session, user_id: UUID, provider: str) -> dict[str, Any]:
        cfg = self.get_credential(db, user_id, provider)
        if cfg is None:
            raise CredentialServiceError(f"Credential for provider '{provider}' not found")
        return cfg

    def list_providers(self, db: Session, user_id: UUID) -> list[str]:
        rows = (
            db.query(ServerCredential.provider)
            .filter(ServerCredential.user_id == user_id)
            .order_by(ServerCredential.provider.asc())
            .all()
        )
        return [str(r[0]) for r in rows]

    def delete_credential(self, db: Session, user_id: UUID, provider: str) -> bool:
        provider_name = provider.strip()
        row = (
            db.query(ServerCredential)
            .filter(ServerCredential.user_id == user_id, ServerCredential.provider == provider_name)
            .first()
        )
        if not row:
            return False
        db.delete(row)
        return True


credential_service = CredentialService()

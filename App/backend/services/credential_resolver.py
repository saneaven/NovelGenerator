"""Resolve provider config (api_key/base_url) using the encrypted credential vault.

Rules (Phase 2):
1) If request already includes api_key, use it (local override).
2) Else, try to load encrypted provider credentials from DB and fill api_key (and base_url for custom).
"""

from __future__ import annotations

from typing import Any, Dict

from sqlalchemy.orm import Session

from ..models.db_models import User, UserCredentials
from .credential_vault_service import CredentialVaultError, decrypt_json


def resolve_provider_config(
    *,
    provider: str,
    request_config: Dict[str, Any],
    current_user: User,
    db: Session,
) -> Dict[str, Any]:
    config: Dict[str, Any] = dict(request_config or {})

    api_key = config.get("api_key")
    if isinstance(api_key, str) and api_key.strip():
        return config

    row = db.query(UserCredentials).filter(UserCredentials.user_id == current_user.id).first()
    if not row:
        return config

    data = decrypt_json(row.provider_credentials_enc)
    provider_cfg = data.get(provider) if isinstance(data, dict) else None
    if not isinstance(provider_cfg, dict):
        return config

    stored_api_key = provider_cfg.get("apiKey")
    if isinstance(stored_api_key, str) and stored_api_key.strip():
        config["api_key"] = stored_api_key

    # Custom provider may store baseUrl in the same credentials blob.
    if provider == "custom":
        base_url = config.get("base_url")
        if not (isinstance(base_url, str) and base_url.strip()):
            stored_base_url = provider_cfg.get("baseUrl")
            if isinstance(stored_base_url, str) and stored_base_url.strip():
                config["base_url"] = stored_base_url

    return config


__all__ = ["resolve_provider_config", "CredentialVaultError"]


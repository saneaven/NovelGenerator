"""Credential vault service.

Stores provider credentials encrypted (Fernet) in the database.
Never returns plaintext credentials to clients.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict

from cryptography.fernet import Fernet, InvalidToken


@dataclass(frozen=True)
class VaultConfig:
    key: str


class CredentialVaultError(RuntimeError):
    pass


def _load_vault_config() -> VaultConfig:
    key = os.getenv("CREDENTIALS_ENCRYPTION_KEY")
    if not key:
        raise CredentialVaultError("CREDENTIALS_ENCRYPTION_KEY is not configured")
    return VaultConfig(key=key)


def _get_fernet() -> Fernet:
    cfg = _load_vault_config()
    try:
        return Fernet(cfg.key.encode("utf-8"))
    except Exception as e:
        raise CredentialVaultError("Invalid CREDENTIALS_ENCRYPTION_KEY") from e


def encrypt_json(data: Dict[str, Any]) -> str:
    """Encrypt a JSON-serializable dict into a Fernet token string."""
    f = _get_fernet()
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    token = f.encrypt(payload)
    return token.decode("utf-8")


def decrypt_json(token: str) -> Dict[str, Any]:
    """Decrypt a Fernet token string into a dict."""
    f = _get_fernet()
    try:
        payload = f.decrypt(token.encode("utf-8"))
    except InvalidToken as e:
        raise CredentialVaultError("Stored credentials cannot be decrypted with the current server key") from e
    return json.loads(payload.decode("utf-8"))


def compute_has_key_by_provider(provider_credentials: Dict[str, Any]) -> Dict[str, bool]:
    """Compute a boolean map indicating whether a provider has a non-empty API key."""
    result: Dict[str, bool] = {}

    for provider, cfg in provider_credentials.items():
        if not isinstance(cfg, dict):
            result[provider] = False
            continue

        # Most providers store apiKey
        api_key = cfg.get("apiKey")
        if isinstance(api_key, str) and api_key.strip():
            result[provider] = True
            continue

        # Custom endpoints may have no key; treat as "no key" in status.
        result[provider] = False

    return result


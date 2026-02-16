from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from .settings_service import settings_service


class AutoApprovePolicyService:
    _KNOWN_KEYS = {"create", "delete", "patch", "replace", "read", "search", "subAgent"}

    def get_effective_policy(
        self,
        db: Session,
        user_id: UUID,
        override: dict[str, bool] | None = None,
    ) -> dict[str, bool]:
        base = settings_service.get_tool_auto_approve_policy(db, user_id)
        if not isinstance(override, dict):
            return base
        merged = dict(base)
        for key, value in override.items():
            if key in self._KNOWN_KEYS:
                merged[key] = bool(value)
        return merged


auto_approve_policy_service = AutoApprovePolicyService()


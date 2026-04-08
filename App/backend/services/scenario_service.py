"""Scenario service for managing version-controlled ScenarioDocuments."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional, List
import uuid

from sqlalchemy import and_, desc
from sqlalchemy.orm import Session

from ..models.db_models import PromptScenarioVersion
from .prompt_runtime.scenario_validation import normalize_and_validate_scenario


@dataclass(frozen=True)
class ScenarioVersionMetadata:
    """Lightweight metadata for a scenario version (no JSONB content)."""
    id: uuid.UUID
    version_number: int
    created_at: datetime
    note: Optional[str]
    is_default: bool


class ScenarioService:
    """Service for managing scenario versions (latest version is active)."""

    @staticmethod
    def get_active_scenario(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        task_subtype: str,
    ) -> Optional[PromptScenarioVersion]:
        return (
            db.query(PromptScenarioVersion)
            .filter(
                and_(
                    PromptScenarioVersion.user_id == user_id,
                    PromptScenarioVersion.preset_id == preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                )
            )
            .order_by(desc(PromptScenarioVersion.version_number))
            .first()
        )

    @staticmethod
    def save_new_version(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        task_subtype: str,
        scenario: dict[str, Any],
        note: Optional[str] = None,
    ) -> tuple[PromptScenarioVersion, dict[str, Any], list[str]]:
        normalized, warnings = normalize_and_validate_scenario(scenario)

        max_row = (
            db.query(PromptScenarioVersion)
            .filter(
                and_(
                    PromptScenarioVersion.user_id == user_id,
                    PromptScenarioVersion.preset_id == preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                )
            )
            .order_by(desc(PromptScenarioVersion.version_number))
            .first()
        )
        new_version_number = (int(max_row.version_number) + 1) if max_row is not None else 1

        row = PromptScenarioVersion(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            task_type=task_type,
            task_subtype=task_subtype,
            scenario=normalized,
            version_number=new_version_number,
            is_default=False,
            note=note,
            created_at=datetime.utcnow(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)

        return row, normalized, warnings

    @staticmethod
    def list_versions(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        task_subtype: str,
    ) -> List[ScenarioVersionMetadata]:
        """Return version metadata only — never loads the heavy ``scenario`` JSONB.

        Use ``get_version_by_number`` to lazy-load a single version's full
        scenario document when the user actually selects it.
        """
        rows = (
            db.query(
                PromptScenarioVersion.id,
                PromptScenarioVersion.version_number,
                PromptScenarioVersion.created_at,
                PromptScenarioVersion.note,
                PromptScenarioVersion.is_default,
            )
            .filter(
                and_(
                    PromptScenarioVersion.user_id == user_id,
                    PromptScenarioVersion.preset_id == preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                )
            )
            .order_by(desc(PromptScenarioVersion.version_number))
            .all()
        )
        return [
            ScenarioVersionMetadata(
                id=row.id,
                version_number=int(row.version_number),
                created_at=row.created_at,
                note=row.note,
                is_default=bool(row.is_default),
            )
            for row in rows
        ]

    @staticmethod
    def get_version_by_number(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        task_subtype: str,
        version_number: int,
    ) -> Optional[PromptScenarioVersion]:
        """Fetch a single scenario version with its full ``scenario`` document."""
        return (
            db.query(PromptScenarioVersion)
            .filter(
                and_(
                    PromptScenarioVersion.user_id == user_id,
                    PromptScenarioVersion.preset_id == preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                    PromptScenarioVersion.version_number == version_number,
                )
            )
            .first()
        )

    @staticmethod
    def restore_version(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        task_subtype: str,
        version_number: int,
    ) -> Optional[PromptScenarioVersion]:
        src = (
            db.query(PromptScenarioVersion)
            .filter(
                and_(
                    PromptScenarioVersion.user_id == user_id,
                    PromptScenarioVersion.preset_id == preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                    PromptScenarioVersion.version_number == version_number,
                )
            )
            .first()
        )
        if src is None:
            return None

        max_row = (
            db.query(PromptScenarioVersion)
            .filter(
                and_(
                    PromptScenarioVersion.user_id == user_id,
                    PromptScenarioVersion.preset_id == preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                )
            )
            .order_by(desc(PromptScenarioVersion.version_number))
            .first()
        )
        new_version_number = (int(max_row.version_number) + 1) if max_row is not None else 1

        restored = PromptScenarioVersion(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            task_type=task_type,
            task_subtype=task_subtype,
            scenario=src.scenario if isinstance(src.scenario, dict) else {},
            version_number=new_version_number,
            is_default=False,
            note=f"Restored from v{src.version_number}",
            created_at=datetime.utcnow(),
        )
        db.add(restored)
        db.commit()
        db.refresh(restored)
        return restored


scenario_service = ScenarioService()


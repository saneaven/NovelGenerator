"""API routes for scenario management (Scenario v1 / Blocks Runtime)."""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..schemas.scenarios import (
    ScenarioContentResponse,
    ScenarioRestoreRequest,
    ScenarioSaveRequest,
    ScenarioSaveResponse,
    ScenarioSimulateRequest,
    ScenarioSimulateResponse,
    ScenarioVersionHistoryItem,
    ScenarioDocument,
)
from ..services.scenario_service import scenario_service
from ..services.prompt_runtime.scenario_runtime import assemble_scenario
from ..services.prompt_runtime.template_renderer import TemplateRenderer, load_user_fragment_map
from ..services.prompt_runtime.scenario_validation import normalize_and_validate_scenario


router = APIRouter(prefix="/api/v1/scenarios", tags=["scenarios"])


def get_active_preset_id(current_user: User) -> uuid.UUID:
    if not current_user.settings or not current_user.settings.active_preset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active preset set. Please select or create a preset first.",
        )
    return current_user.settings.active_preset_id


@router.get(
    "/{task_type}/{task_subtype}",
    response_model=ScenarioContentResponse,
)
async def get_scenario(
    task_type: str = Path(..., description="Task type (agent, translation, etc.)"),
    task_subtype: str = Path(..., description="Task subtype (planMode, agentMode, object, etc.)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    row = scenario_service.get_active_scenario(
        db,
        user_id=current_user.id,
        preset_id=preset_id,
        task_type=task_type,
        task_subtype=task_subtype,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found")

    scenario_doc = row.scenario if isinstance(row.scenario, dict) else {}
    return ScenarioContentResponse(
        scenario=ScenarioDocument.model_validate(scenario_doc),
        version_number=int(row.version_number),
        created_at=row.created_at,
        is_system_default=bool(row.is_default),
    )


@router.post(
    "/{task_type}/{task_subtype}/save",
    response_model=ScenarioSaveResponse,
)
async def save_scenario(
    task_type: str,
    task_subtype: str,
    data: ScenarioSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    try:
        row, normalized, warnings = scenario_service.save_new_version(
            db,
            user_id=current_user.id,
            preset_id=preset_id,
            task_type=task_type,
            task_subtype=task_subtype,
            scenario=data.scenario.model_dump(),
            note=data.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ScenarioSaveResponse(
        id=str(row.id),
        version_number=int(row.version_number),
        created_at=row.created_at,
        is_system_default=bool(row.is_default),
        warnings=warnings,
        scenario=ScenarioDocument.model_validate(normalized),
    )


@router.get(
    "/{task_type}/{task_subtype}/versions",
    response_model=list[ScenarioVersionHistoryItem],
)
async def get_scenario_versions(
    task_type: str,
    task_subtype: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    rows = scenario_service.list_versions(
        db,
        user_id=current_user.id,
        preset_id=preset_id,
        task_type=task_type,
        task_subtype=task_subtype,
    )
    out: list[ScenarioVersionHistoryItem] = []
    for row in rows:
        scenario_doc = row.scenario if isinstance(row.scenario, dict) else {}
        out.append(
            ScenarioVersionHistoryItem(
                version_number=int(row.version_number),
                created_at=row.created_at,
                note=row.note,
                is_system_default=bool(row.is_default),
                preview=json.dumps(scenario_doc, indent=2, ensure_ascii=False),
            )
        )
    return out


@router.post(
    "/{task_type}/{task_subtype}/restore",
    status_code=status.HTTP_200_OK,
)
async def restore_scenario_version(
    task_type: str,
    task_subtype: str,
    data: ScenarioRestoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    restored = scenario_service.restore_version(
        db,
        user_id=current_user.id,
        preset_id=preset_id,
        task_type=task_type,
        task_subtype=task_subtype,
        version_number=data.version_number,
    )
    if restored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario version not found")
    return {
        "success": True,
        "restored_from": int(data.version_number),
        "new_version": int(restored.version_number),
    }


@router.post(
    "/simulate",
    response_model=ScenarioSimulateResponse,
)
async def simulate_scenario(
    data: ScenarioSimulateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    fragment_map = load_user_fragment_map(db, current_user.id, preset_id)
    template_renderer = TemplateRenderer(fragment_map=fragment_map)

    try:
        normalized, _warnings = normalize_and_validate_scenario(data.scenario.model_dump())
        system_template = str(normalized.get("system_template") or "")
        blocks = normalized.get("blocks") if isinstance(normalized.get("blocks"), list) else []
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        rendered_system_prompt, rendered_conversation, memory_template = assemble_scenario(
            template_renderer=template_renderer,
            task_type=str(data.task_type or ""),
            system_template=system_template,
            blocks=blocks,
            source_conversation=data.source_conversation,
            template_data=data.template_data,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return ScenarioSimulateResponse(
        rendered_system_prompt=rendered_system_prompt,
        rendered_conversation=rendered_conversation,
        memory_template=memory_template,
    )

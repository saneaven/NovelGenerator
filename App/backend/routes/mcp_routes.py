from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.db_models import User
from ..schemas.mcp import McpServerCreate, McpServerResponse, McpServerUpdate
from ..services.demo_policy import require_demo_off
from ..services.mcp import mcp_server_service, mcp_sync_service


router = APIRouter(prefix="/api/v1/presets/{preset_id}/mcp-servers", tags=["mcp"])


@router.get("", response_model=list[McpServerResponse])
async def list_mcp_servers(
    preset_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return mcp_server_service.list_servers(db, user_id=current_user.id, preset_id=preset_id)


@router.post("", response_model=McpServerResponse, status_code=status.HTTP_201_CREATED)
async def create_mcp_server(
    preset_id: uuid.UUID,
    data: McpServerCreate,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await mcp_server_service.create_server(db, user_id=current_user.id, preset_id=preset_id, data=data)


@router.patch("/{server_id}", response_model=McpServerResponse)
async def update_mcp_server(
    preset_id: uuid.UUID,
    server_id: uuid.UUID,
    data: McpServerUpdate,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await mcp_server_service.update_server(
        db,
        user_id=current_user.id,
        preset_id=preset_id,
        server_id=server_id,
        data=data,
    )


@router.delete("/{server_id}", status_code=status.HTTP_200_OK)
async def delete_mcp_server(
    preset_id: uuid.UUID,
    server_id: uuid.UUID,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mcp_server_service.delete_server(db, user_id=current_user.id, preset_id=preset_id, server_id=server_id)
    return {"success": True}


@router.post("/{server_id}/sync", response_model=McpServerResponse)
async def sync_mcp_server(
    preset_id: uuid.UUID,
    server_id: uuid.UUID,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mcp_server_service.list_servers(db, user_id=current_user.id, preset_id=preset_id)
    try:
        await mcp_sync_service.sync_server(db, server_id=server_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    rows = mcp_server_service.list_servers(db, user_id=current_user.id, preset_id=preset_id)
    for row in rows:
        if row.id == server_id:
            return row
    raise HTTPException(status_code=404, detail="MCP server not found")

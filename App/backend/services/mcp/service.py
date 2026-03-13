from __future__ import annotations

import base64
import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import PurePosixPath
from typing import Any, Iterable, Literal
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import and_
from sqlalchemy.orm import Session

from ...models.db_models import (
    McpServerModel,
    McpServerSecretModel,
    McpServerSnapshotModel,
    PromptPreset,
    RunModel,
    SubAgentDefinitionModel,
    Thread,
)
from ...schemas.mcp import (
    JinjaMcpContext,
    JinjaMcpPromptContext,
    JinjaMcpPromptMessage,
    JinjaMcpResourceContext,
    McpAuthInput,
    McpSelection,
    McpSelectionPrompt,
    McpSelectionResource,
    McpServerCreate,
    McpServerResponse,
    McpServerSnapshot,
    McpServerUpdate,
    NormalizedMcpCatalog,
    RunMcpAuditItem,
    RunMcpResolution,
)
from ..storage_service import storage_service


MCP_SELECTOR_SNAPSHOT_MAX_AGE_SECONDS = 600
MCP_TOOL_SNAPSHOT_MAX_AGE_SECONDS = 300
MCP_BINARY_STORAGE_PREFIX = "mcp"
MCP_TEXT_PREVIEW_LIMIT = 4000


def _empty_catalog() -> dict[str, Any]:
    return {
        "supports": {
            "tools": False,
            "prompts": False,
            "resources": False,
            "resource_templates": False,
            "roots": False,
            "elicitation": False,
            "sampling": False,
            "tasks": False,
        },
        "tools": [],
        "prompts": [],
        "resources": [],
        "resource_templates": [],
    }


def _empty_resolution() -> dict[str, Any]:
    return {
        "system_overlays": [],
        "injected_messages": [],
        "user_message_parts": [],
        "template_contexts": [],
        "tool_server_ids": [],
        "audit": [],
    }


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", str(value or "").strip().lower())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    if not normalized:
        return "item"
    if normalized[0].isdigit():
        normalized = f"n_{normalized}"
    return normalized[:80]


def _jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", exclude_none=True)
    return jsonable_encoder(value)


def _collapse_text(parts: Iterable[dict[str, Any]]) -> str:
    return "\n".join(
        str(part.get("text") or "").strip()
        for part in parts
        if isinstance(part, dict) and part.get("type") == "content" and str(part.get("text") or "").strip()
    ).strip()


def _is_text_mime(mime_type: str | None) -> bool:
    normalized = str(mime_type or "").strip().lower()
    return normalized.startswith("text/") or normalized in {
        "application/json",
        "application/xml",
        "application/yaml",
        "application/x-yaml",
        "application/markdown",
        "text/markdown",
    }


def _looks_like_image_mime(mime_type: str | None) -> bool:
    return str(mime_type or "").strip().lower().startswith("image/")


def _preview_text(value: str | None) -> str:
    text = str(value or "")
    if len(text) <= MCP_TEXT_PREVIEW_LIMIT:
        return text
    return f"{text[:MCP_TEXT_PREVIEW_LIMIT]}..."


def _guess_filename(name: str | None, uri: str | None, mime_type: str | None) -> str:
    base_name = str(name or "").strip()
    if base_name:
        return base_name

    parsed = urlparse(str(uri or ""))
    path_name = PurePosixPath(parsed.path).name
    if path_name:
        return path_name

    suffix = ""
    normalized_mime = str(mime_type or "").strip().lower()
    if normalized_mime == "application/pdf":
        suffix = ".pdf"
    elif normalized_mime == "text/markdown":
        suffix = ".md"
    elif normalized_mime == "application/json":
        suffix = ".json"
    elif normalized_mime.startswith("image/"):
        suffix = f".{normalized_mime.split('/', 1)[1]}"
    return f"mcp_resource{suffix}"


def _normalize_headers(auth_payload: dict[str, Any], auth_kind: str) -> dict[str, str]:
    if auth_kind == "none":
        return {}
    if auth_kind == "bearer":
        token = str(auth_payload.get("token") or "").strip()
        return {"Authorization": f"Bearer {token}"} if token else {}
    if auth_kind == "headers":
        out: dict[str, str] = {}
        for item in auth_payload.get("headers") or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            out[name] = str(item.get("value") or "")
        return out
    return {}


@dataclass(frozen=True)
class McpRuntimeContext:
    db: Session
    user_id: uuid.UUID
    preset_id: uuid.UUID
    thread_id: uuid.UUID
    run_id: uuid.UUID
    invocation_mode: Literal["agentMode", "planMode", "subAgent"]
    sub_agent_id: uuid.UUID | None
    language: str
    input_text: str
    input_payload: dict[str, Any]


class McpSecretService:
    def __init__(self) -> None:
        self._fernet: Fernet | None = None

    def _get_fernet(self) -> Fernet:
        if self._fernet is not None:
            return self._fernet
        key = os.getenv("CREDENTIAL_ENCRYPTION_KEY")
        if not key:
            raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY must be set")
        self._fernet = Fernet(key.encode("utf-8"))
        return self._fernet

    def encrypt_auth(self, auth: McpAuthInput | dict[str, Any]) -> tuple[str, str]:
        auth_payload = auth.model_dump(mode="json") if hasattr(auth, "model_dump") else dict(auth)
        auth_kind = str(auth_payload.get("auth_kind") or "none")
        payload = json.dumps(auth_payload, separators=(",", ":"), ensure_ascii=False)
        token = self._get_fernet().encrypt(payload.encode("utf-8"))
        return auth_kind, token.decode("utf-8")

    def decrypt_auth(self, row: McpServerSecretModel) -> dict[str, Any]:
        encrypted = str(row.encrypted_payload or "")
        try:
            raw = self._get_fernet().decrypt(encrypted.encode("utf-8"))
        except InvalidToken as exc:
            raise RuntimeError("Failed to decrypt MCP auth payload") from exc
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError("MCP auth payload must be an object")
        return payload


class McpTransport:
    async def _with_session(self, server: McpServerModel, auth_row: McpServerSecretModel, callback):
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        auth_payload = mcp_secret_service.decrypt_auth(auth_row)
        headers = _normalize_headers(auth_payload, str(auth_row.auth_kind or "none"))
        async with streamablehttp_client(server.server_url, headers=headers) as (
            read_stream,
            write_stream,
            _response,
        ):
            async with ClientSession(read_stream, write_stream) as session:
                initialize_result = await session.initialize()
                return await callback(session, _jsonable(initialize_result))

    async def initialize(self, server: McpServerModel, auth_row: McpServerSecretModel) -> dict[str, Any]:
        async def _callback(_session, initialize_result):
            return initialize_result

        return await self._with_session(server, auth_row, _callback)

    async def list_tools(self, server: McpServerModel, auth_row: McpServerSecretModel) -> dict[str, Any]:
        async def _callback(session, _initialize_result):
            return _jsonable(await session.list_tools())

        return await self._with_session(server, auth_row, _callback)

    async def list_prompts(self, server: McpServerModel, auth_row: McpServerSecretModel) -> dict[str, Any]:
        async def _callback(session, _initialize_result):
            return _jsonable(await session.list_prompts())

        return await self._with_session(server, auth_row, _callback)

    async def get_prompt(
        self,
        server: McpServerModel,
        auth_row: McpServerSecretModel,
        name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        async def _callback(session, _initialize_result):
            return _jsonable(await session.get_prompt(name, arguments=arguments))

        return await self._with_session(server, auth_row, _callback)

    async def list_resources(self, server: McpServerModel, auth_row: McpServerSecretModel) -> dict[str, Any]:
        async def _callback(session, _initialize_result):
            return _jsonable(await session.list_resources())

        return await self._with_session(server, auth_row, _callback)

    async def read_resource(
        self,
        server: McpServerModel,
        auth_row: McpServerSecretModel,
        uri: str,
    ) -> dict[str, Any]:
        async def _callback(session, _initialize_result):
            return _jsonable(await session.read_resource(uri))

        return await self._with_session(server, auth_row, _callback)

    async def call_tool(
        self,
        server: McpServerModel,
        auth_row: McpServerSecretModel,
        name: str,
        arguments: dict[str, Any],
        _ctx: McpRuntimeContext,
    ) -> dict[str, Any]:
        async def _callback(session, _initialize_result):
            return _jsonable(await session.call_tool(name, arguments))

        return await self._with_session(server, auth_row, _callback)


class McpServerService:
    @staticmethod
    def require_owned_preset(db: Session, *, user_id: uuid.UUID, preset_id: uuid.UUID) -> PromptPreset:
        preset = (
            db.query(PromptPreset)
            .filter(PromptPreset.id == preset_id, PromptPreset.user_id == user_id)
            .first()
        )
        if preset is None:
            raise HTTPException(status_code=404, detail="Preset not found")
        return preset

    @staticmethod
    def _serialize_snapshot(row: McpServerSnapshotModel | None) -> McpServerSnapshot:
        raw_catalog = row.catalog_json if row and isinstance(row.catalog_json, dict) else _empty_catalog()
        raw_server_info = row.server_info_json if row and isinstance(row.server_info_json, dict) else {}
        raw_capabilities = row.capabilities_raw_json if row and isinstance(row.capabilities_raw_json, dict) else {}
        return McpServerSnapshot(
            protocol_version=row.protocol_version if row else None,
            server_info=raw_server_info,
            capabilities_raw=raw_capabilities,
            catalog=NormalizedMcpCatalog.model_validate(raw_catalog),
            sync_error=row.sync_error if row else None,
            synced_at=row.synced_at.isoformat() if row and row.synced_at else None,
        )

    @staticmethod
    def serialize_server(row: McpServerModel) -> McpServerResponse:
        secret = row.secret
        snapshot = row.snapshot
        if secret is None or snapshot is None:
            raise RuntimeError("MCP server rows must include secret and snapshot")
        return McpServerResponse(
            id=row.id,
            server_key=row.server_key,
            display_name=row.display_name,
            server_url=row.server_url,
            enabled=bool(row.enabled),
            allow_agent_mode=bool(row.allow_agent_mode),
            allow_plan_mode=bool(row.allow_plan_mode),
            auth_kind=secret.auth_kind,  # type: ignore[arg-type]
            snapshot=McpServerService._serialize_snapshot(snapshot),
        )

    @staticmethod
    def list_servers(db: Session, *, user_id: uuid.UUID, preset_id: uuid.UUID) -> list[McpServerResponse]:
        McpServerService.require_owned_preset(db, user_id=user_id, preset_id=preset_id)
        rows = (
            db.query(McpServerModel)
            .filter(McpServerModel.user_id == user_id, McpServerModel.preset_id == preset_id)
            .order_by(McpServerModel.display_name.asc(), McpServerModel.server_key.asc())
            .all()
        )
        return [McpServerService.serialize_server(row) for row in rows]

    @staticmethod
    def _ensure_secret_and_snapshot(db: Session, *, server: McpServerModel, auth: McpAuthInput | dict[str, Any]) -> None:
        auth_kind, encrypted = mcp_secret_service.encrypt_auth(auth)
        if server.secret is None:
            server.secret = McpServerSecretModel(
                id=uuid.uuid4(),
                server_id=server.id,
                auth_kind=auth_kind,
                encrypted_payload=encrypted,
                updated_at=datetime.utcnow(),
            )
        else:
            server.secret.auth_kind = auth_kind
            server.secret.encrypted_payload = encrypted
            server.secret.updated_at = datetime.utcnow()

        if server.snapshot is None:
            server.snapshot = McpServerSnapshotModel(
                id=uuid.uuid4(),
                server_id=server.id,
                protocol_version=None,
                server_info_json={},
                capabilities_raw_json={},
                catalog_json=_empty_catalog(),
                sync_error=None,
                synced_at=None,
                updated_at=datetime.utcnow(),
            )

    @staticmethod
    def _get_server(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        server_id: uuid.UUID,
    ) -> McpServerModel:
        row = (
            db.query(McpServerModel)
            .filter(
                McpServerModel.id == server_id,
                McpServerModel.user_id == user_id,
                McpServerModel.preset_id == preset_id,
            )
            .first()
        )
        if row is None:
            raise HTTPException(status_code=404, detail="MCP server not found")
        if row.secret is None or row.snapshot is None:
            raise RuntimeError("MCP server rows must include secret and snapshot")
        return row

    @staticmethod
    async def create_server(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        data: McpServerCreate,
    ) -> McpServerResponse:
        McpServerService.require_owned_preset(db, user_id=user_id, preset_id=preset_id)
        now = datetime.utcnow()
        row = McpServerModel(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            server_key=data.server_key,
            display_name=data.display_name,
            server_url=data.server_url,
            enabled=data.enabled,
            allow_agent_mode=data.allow_agent_mode,
            allow_plan_mode=data.allow_plan_mode,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        db.flush()
        McpServerService._ensure_secret_and_snapshot(db, server=row, auth=data.auth)
        db.commit()
        db.refresh(row)
        try:
            await mcp_sync_service.sync_server(db, server_id=row.id)
        except Exception:
            db.rollback()
            db.refresh(row)
        return McpServerService.serialize_server(McpServerService._get_server(db, user_id=user_id, preset_id=preset_id, server_id=row.id))

    @staticmethod
    async def update_server(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        server_id: uuid.UUID,
        data: McpServerUpdate,
    ) -> McpServerResponse:
        row = McpServerService._get_server(db, user_id=user_id, preset_id=preset_id, server_id=server_id)
        if data.server_key is not None:
            row.server_key = data.server_key
        if data.display_name is not None:
            row.display_name = data.display_name
        if data.server_url is not None:
            row.server_url = data.server_url
        if data.enabled is not None:
            row.enabled = data.enabled
        if data.allow_agent_mode is not None:
            row.allow_agent_mode = data.allow_agent_mode
        if data.allow_plan_mode is not None:
            row.allow_plan_mode = data.allow_plan_mode
        row.updated_at = datetime.utcnow()
        if data.auth is not None:
            McpServerService._ensure_secret_and_snapshot(db, server=row, auth=data.auth)
        db.commit()
        db.refresh(row)
        try:
            await mcp_sync_service.sync_server(db, server_id=row.id)
        except Exception:
            db.rollback()
            db.refresh(row)
        return McpServerService.serialize_server(McpServerService._get_server(db, user_id=user_id, preset_id=preset_id, server_id=row.id))

    @staticmethod
    def delete_server(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        server_id: uuid.UUID,
    ) -> None:
        row = McpServerService._get_server(db, user_id=user_id, preset_id=preset_id, server_id=server_id)
        db.delete(row)
        db.commit()

    @staticmethod
    def export_servers(db: Session, *, user_id: uuid.UUID, preset_id: uuid.UUID) -> list[dict[str, Any]]:
        return [item.model_dump(mode="json") for item in McpServerService.list_servers(db, user_id=user_id, preset_id=preset_id)]

    @staticmethod
    def import_servers(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        items: list[dict[str, Any]],
    ) -> dict[uuid.UUID, uuid.UUID]:
        now = datetime.utcnow()
        id_map: dict[uuid.UUID, uuid.UUID] = {}
        for item in items:
            payload = McpServerResponse.model_validate(item)
            new_id = uuid.uuid4()
            id_map[payload.id] = new_id
            row = McpServerModel(
                id=new_id,
                user_id=user_id,
                preset_id=preset_id,
                server_key=payload.server_key,
                display_name=payload.display_name,
                server_url=payload.server_url,
                enabled=payload.enabled,
                allow_agent_mode=payload.allow_agent_mode,
                allow_plan_mode=payload.allow_plan_mode,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            db.flush()
            empty_auth: dict[str, Any]
            if payload.auth_kind == "bearer":
                empty_auth = {"auth_kind": "bearer", "token": ""}
            elif payload.auth_kind == "headers":
                empty_auth = {"auth_kind": "headers", "headers": []}
            else:
                empty_auth = {"auth_kind": "none"}
            McpServerService._ensure_secret_and_snapshot(db, server=row, auth=empty_auth)
            row.snapshot.protocol_version = payload.snapshot.protocol_version
            row.snapshot.server_info_json = payload.snapshot.server_info
            row.snapshot.capabilities_raw_json = payload.snapshot.capabilities_raw
            row.snapshot.catalog_json = payload.snapshot.catalog.model_dump(mode="json")
            row.snapshot.sync_error = payload.snapshot.sync_error
            row.snapshot.synced_at = (
                datetime.fromisoformat(payload.snapshot.synced_at.replace("Z", "+00:00"))
                if payload.snapshot.synced_at
                else None
            )
            row.snapshot.updated_at = now
        return id_map

    @staticmethod
    def copy_servers(
        db: Session,
        *,
        user_id: uuid.UUID,
        source_preset_id: uuid.UUID,
        target_preset_id: uuid.UUID,
    ) -> dict[uuid.UUID, uuid.UUID]:
        rows = (
            db.query(McpServerModel)
            .filter(
                McpServerModel.user_id == user_id,
                McpServerModel.preset_id == source_preset_id,
            )
            .order_by(McpServerModel.created_at.asc(), McpServerModel.id.asc())
            .all()
        )
        id_map: dict[uuid.UUID, uuid.UUID] = {}
        now = datetime.utcnow()
        for row in rows:
            new_id = uuid.uuid4()
            id_map[row.id] = new_id
            clone = McpServerModel(
                id=new_id,
                user_id=user_id,
                preset_id=target_preset_id,
                server_key=row.server_key,
                display_name=row.display_name,
                server_url=row.server_url,
                enabled=row.enabled,
                allow_agent_mode=row.allow_agent_mode,
                allow_plan_mode=row.allow_plan_mode,
                created_at=now,
                updated_at=now,
            )
            db.add(clone)
            db.flush()
            if row.secret is None or row.snapshot is None:
                raise RuntimeError("MCP server rows must include secret and snapshot")
            clone.secret = McpServerSecretModel(
                id=uuid.uuid4(),
                server_id=clone.id,
                auth_kind=row.secret.auth_kind,
                encrypted_payload=row.secret.encrypted_payload,
                updated_at=now,
            )
            clone.snapshot = McpServerSnapshotModel(
                id=uuid.uuid4(),
                server_id=clone.id,
                protocol_version=row.snapshot.protocol_version,
                server_info_json=row.snapshot.server_info_json,
                capabilities_raw_json=row.snapshot.capabilities_raw_json,
                catalog_json=row.snapshot.catalog_json,
                sync_error=row.snapshot.sync_error,
                synced_at=row.snapshot.synced_at,
                updated_at=now,
            )
        return id_map


class McpSyncService:
    @staticmethod
    def _supports_from_initialize(payload: dict[str, Any]) -> dict[str, bool]:
        capabilities = payload.get("capabilities") if isinstance(payload, dict) else {}
        if not isinstance(capabilities, dict):
            capabilities = {}
        resources_cap = capabilities.get("resources")
        resources_details = resources_cap if isinstance(resources_cap, dict) else {}
        return {
            "tools": bool(capabilities.get("tools")),
            "prompts": bool(capabilities.get("prompts")),
            "resources": bool(resources_cap),
            "resource_templates": bool(resources_details.get("templates")),
            "roots": bool(capabilities.get("roots")),
            "elicitation": bool(capabilities.get("elicitation")),
            "sampling": bool(capabilities.get("sampling")),
            "tasks": bool(capabilities.get("tasks")),
        }

    @staticmethod
    def _normalize_catalog(
        *,
        server: McpServerModel,
        supports: dict[str, bool],
        tools_payload: dict[str, Any] | None,
        prompts_payload: dict[str, Any] | None,
        resources_payload: dict[str, Any] | None,
    ) -> dict[str, Any]:
        out = _empty_catalog()
        out["supports"].update(supports)

        tools_seen: dict[str, int] = {}
        for item in (tools_payload or {}).get("tools") or []:
            if not isinstance(item, dict):
                continue
            remote_name = str(item.get("name") or "").strip()
            if not remote_name:
                continue
            base_local = f"mcp__{server.server_key}__{_slug(remote_name)}"
            count = tools_seen.get(base_local, 0) + 1
            tools_seen[base_local] = count
            local_name = base_local if count == 1 else f"{base_local}__{count}"
            out["tools"].append(
                {
                    "local_name": local_name,
                    "remote_name": remote_name,
                    "title": item.get("title"),
                    "description": item.get("description"),
                    "input_schema": item.get("inputSchema") if isinstance(item.get("inputSchema"), dict) else {},
                    "annotations": item.get("annotations") if isinstance(item.get("annotations"), dict) else None,
                }
            )

        for item in (prompts_payload or {}).get("prompts") or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            arguments = []
            for arg in item.get("arguments") or []:
                if not isinstance(arg, dict):
                    continue
                arg_name = str(arg.get("name") or "").strip()
                if not arg_name:
                    continue
                arguments.append(
                    {
                        "name": arg_name,
                        "description": arg.get("description"),
                        "required": bool(arg.get("required")),
                    }
                )
            out["prompts"].append(
                {
                    "name": name,
                    "title": item.get("title"),
                    "description": item.get("description"),
                    "arguments": arguments,
                }
            )

        resources_root = resources_payload or {}
        for item in resources_root.get("resources") or []:
            if not isinstance(item, dict):
                continue
            uri = str(item.get("uri") or "").strip()
            if not uri:
                continue
            out["resources"].append(
                {
                    "uri": uri,
                    "name": item.get("name"),
                    "title": item.get("title"),
                    "description": item.get("description"),
                    "mime_type": item.get("mimeType"),
                }
            )
        templates = resources_root.get("resourceTemplates") or []
        if isinstance(templates, list):
            out["resource_templates"] = [item for item in templates if isinstance(item, dict)]
            if out["resource_templates"]:
                out["supports"]["resource_templates"] = True

        return out

    @staticmethod
    async def sync_server(db: Session, *, server_id: uuid.UUID) -> McpServerSnapshotModel:
        server = db.query(McpServerModel).filter(McpServerModel.id == server_id).first()
        if server is None or server.secret is None or server.snapshot is None:
            raise RuntimeError("MCP server not found")

        try:
            initialize_payload = await mcp_transport.initialize(server, server.secret)
            supports = McpSyncService._supports_from_initialize(initialize_payload)
            tools_payload = await mcp_transport.list_tools(server, server.secret) if supports["tools"] else {}
            prompts_payload = await mcp_transport.list_prompts(server, server.secret) if supports["prompts"] else {}
            resources_payload = await mcp_transport.list_resources(server, server.secret) if supports["resources"] else {}
            catalog = McpSyncService._normalize_catalog(
                server=server,
                supports=supports,
                tools_payload=tools_payload,
                prompts_payload=prompts_payload,
                resources_payload=resources_payload,
            )
            server.snapshot.protocol_version = str(initialize_payload.get("protocolVersion") or "") or None
            server.snapshot.server_info_json = initialize_payload.get("serverInfo") if isinstance(initialize_payload.get("serverInfo"), dict) else {}
            server.snapshot.capabilities_raw_json = {
                "initialize": initialize_payload,
                "list_tools": tools_payload,
                "list_prompts": prompts_payload,
                "list_resources": resources_payload,
            }
            server.snapshot.catalog_json = catalog
            server.snapshot.sync_error = None
            server.snapshot.synced_at = datetime.utcnow()
            server.snapshot.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(server.snapshot)
            return server.snapshot
        except Exception as exc:
            server.snapshot.sync_error = str(exc)
            server.snapshot.updated_at = datetime.utcnow()
            db.commit()
            raise

    @staticmethod
    async def sync_stale_tool_servers(
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        thread: Thread,
        run: RunModel,
    ) -> None:
        ctx = mcp_policy_service.build_runtime_context(
            db,
            user_id=user_id,
            preset_id=preset_id,
            thread=thread,
            run=run,
            input_text="",
            input_payload=run.input_payload if isinstance(run.input_payload, dict) else {},
        )
        servers = mcp_policy_service.allowed_servers(ctx)
        stale_before = datetime.utcnow() - timedelta(seconds=MCP_TOOL_SNAPSHOT_MAX_AGE_SECONDS)
        for server in servers:
            snapshot = server.snapshot
            if snapshot is None:
                continue
            supports = snapshot.catalog_json.get("supports") if isinstance(snapshot.catalog_json, dict) else {}
            if not isinstance(supports, dict) or not bool(supports.get("tools")):
                continue
            if snapshot.synced_at is not None and snapshot.synced_at >= stale_before:
                continue
            try:
                await McpSyncService.sync_server(db, server_id=server.id)
            except Exception:
                db.rollback()


class McpPolicyService:
    def build_runtime_context(
        self,
        db: Session,
        *,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        thread: Thread,
        run: RunModel,
        input_text: str,
        input_payload: dict[str, Any],
    ) -> McpRuntimeContext:
        invocation_mode: Literal["agentMode", "planMode", "subAgent"]
        sub_agent_id: uuid.UUID | None = None
        if thread.thread_type == "subAgent":
            invocation_mode = "subAgent"
            sub_agent_id = thread.parent_id
        elif run.run_mode == "planMode":
            invocation_mode = "planMode"
        else:
            invocation_mode = "agentMode"
        return McpRuntimeContext(
            db=db,
            user_id=user_id,
            preset_id=preset_id,
            thread_id=thread.id,
            run_id=run.id,
            invocation_mode=invocation_mode,
            sub_agent_id=sub_agent_id,
            language=run.language,
            input_text=input_text,
            input_payload=input_payload if isinstance(input_payload, dict) else {},
        )

    def allowed_servers(self, ctx: McpRuntimeContext) -> list[McpServerModel]:
        rows = (
            ctx.db.query(McpServerModel)
            .filter(
                McpServerModel.user_id == ctx.user_id,
                McpServerModel.preset_id == ctx.preset_id,
                McpServerModel.enabled == True,  # noqa: E712
            )
            .order_by(McpServerModel.display_name.asc(), McpServerModel.server_key.asc())
            .all()
        )
        if ctx.invocation_mode == "agentMode":
            return [row for row in rows if row.allow_agent_mode]
        if ctx.invocation_mode == "planMode":
            return [row for row in rows if row.allow_plan_mode]
        if ctx.sub_agent_id is None:
            return []
        definition = (
            ctx.db.query(SubAgentDefinitionModel)
            .filter(
                SubAgentDefinitionModel.id == ctx.sub_agent_id,
                SubAgentDefinitionModel.user_id == ctx.user_id,
                SubAgentDefinitionModel.preset_id == ctx.preset_id,
                SubAgentDefinitionModel.enabled == True,  # noqa: E712
            )
            .first()
        )
        if definition is None:
            return []
        allowed_ids: set[uuid.UUID] = set()
        for raw in definition.allowed_mcp_server_ids or []:
            try:
                allowed_ids.add(uuid.UUID(str(raw)))
            except ValueError:
                continue
        return [row for row in rows if row.id in allowed_ids]

    def allowed_server_ids(self, ctx: McpRuntimeContext) -> set[uuid.UUID]:
        return {row.id for row in self.allowed_servers(ctx)}


class McpResolver:
    @staticmethod
    def _tool_server_ids(ctx: McpRuntimeContext) -> list[uuid.UUID]:
        out: list[uuid.UUID] = []
        for server in mcp_policy_service.allowed_servers(ctx):
            snapshot = server.snapshot
            catalog = snapshot.catalog_json if snapshot and isinstance(snapshot.catalog_json, dict) else {}
            supports = catalog.get("supports") if isinstance(catalog, dict) else {}
            if isinstance(supports, dict) and bool(supports.get("tools")):
                out.append(server.id)
        return out

    @staticmethod
    def _save_binary_part(
        *,
        project_id: uuid.UUID,
        filename: str,
        mime_type: str,
        raw_bytes: bytes,
    ) -> dict[str, Any]:
        storage_key, stored_mime_type, _stored_size = storage_service.save_raw_file(
            raw_bytes,
            filename,
            project_id,
            storage_prefix=MCP_BINARY_STORAGE_PREFIX,
            mime_type=mime_type,
        )
        if _looks_like_image_mime(stored_mime_type):
            return {
                "type": "image",
                "mime_type": stored_mime_type,
                "filename": filename,
                "storage_key": storage_key,
                "width": None,
                "height": None,
            }
        return {
            "type": "file",
            "mime_type": stored_mime_type,
            "filename": filename,
            "storage_key": storage_key,
        }

    @staticmethod
    def _normalize_resource_item(
        *,
        item: dict[str, Any],
        project_id: uuid.UUID,
        default_uri: str | None = None,
        default_name: str | None = None,
    ) -> tuple[list[dict[str, Any]], JinjaMcpResourceContext]:
        if not isinstance(item, dict):
            raise ValueError("Invalid MCP resource item")

        uri = str(item.get("uri") or default_uri or "").strip()
        name = str(item.get("name") or default_name or "").strip() or None
        mime_type = str(item.get("mimeType") or item.get("mime_type") or "").strip().lower() or None
        text_value = item.get("text")
        blob_value = item.get("blob") or item.get("data")
        filename = _guess_filename(name, uri, mime_type)

        if isinstance(text_value, str) and (_is_text_mime(mime_type) or mime_type is None):
            part = {"type": "content", "text": text_value}
            return [part], JinjaMcpResourceContext(
                uri=uri,
                name=name,
                mimeType=mime_type,
                text=_preview_text(text_value),
                hasBinary=False,
            )

        if isinstance(blob_value, str):
            raw_bytes = base64.b64decode(blob_value)
            part = McpResolver._save_binary_part(
                project_id=project_id,
                filename=filename,
                mime_type=mime_type or "application/octet-stream",
                raw_bytes=raw_bytes,
            )
            return [part], JinjaMcpResourceContext(
                uri=uri,
                name=name,
                mimeType=mime_type,
                text=None,
                hasBinary=True,
            )

        if isinstance(text_value, str):
            part = {"type": "content", "text": text_value}
            return [part], JinjaMcpResourceContext(
                uri=uri,
                name=name,
                mimeType=mime_type,
                text=_preview_text(text_value),
                hasBinary=False,
            )

        raise ValueError("Unsupported MCP resource payload")

    @staticmethod
    def _normalize_content_blocks(
        *,
        content: Any,
        project_id: uuid.UUID,
    ) -> tuple[list[dict[str, Any]], str, bool]:
        if isinstance(content, list):
            merged_parts: list[dict[str, Any]] = []
            previews: list[str] = []
            has_binary = False
            for block in content:
                parts, preview, block_binary = McpResolver._normalize_content_blocks(content=block, project_id=project_id)
                merged_parts.extend(parts)
                if preview:
                    previews.append(preview)
                has_binary = has_binary or block_binary
            return merged_parts, "\n".join(previews).strip(), has_binary

        if isinstance(content, dict):
            block_type = str(content.get("type") or "").strip()
            if block_type == "text":
                text = str(content.get("text") or "")
                return [{"type": "content", "text": text}], _preview_text(text), False
            if block_type in {"resource", "embeddedResource"}:
                nested = content.get("resource")
                if not isinstance(nested, dict):
                    nested = content.get("embeddedResource")
                if not isinstance(nested, dict):
                    raise ValueError("MCP embedded resource block is missing resource payload")
                parts, ctx = McpResolver._normalize_resource_item(item=nested, project_id=project_id)
                return parts, _preview_text(ctx.text), ctx.hasBinary
            if "text" in content or "blob" in content or "data" in content:
                parts, ctx = McpResolver._normalize_resource_item(item=content, project_id=project_id)
                return parts, _preview_text(ctx.text), ctx.hasBinary
        raise ValueError("Unsupported MCP content block")

    @staticmethod
    def _ensure_server_group(
        groups: dict[uuid.UUID, dict[str, Any]],
        *,
        server: McpServerModel,
    ) -> dict[str, Any]:
        group = groups.get(server.id)
        if group is None:
            group = {
                "name": server.display_name,
                "serverName": server.display_name,
                "prompts": [],
                "resources": [],
            }
            groups[server.id] = group
        return group

    @staticmethod
    def _normalize_prompt_result(
        *,
        raw_prompt: dict[str, Any],
        server: McpServerModel,
        selection: McpSelectionPrompt,
        project_id: uuid.UUID,
        groups: dict[uuid.UUID, dict[str, Any]],
    ) -> tuple[list[dict[str, str]], list[dict[str, Any]], RunMcpAuditItem]:
        messages = raw_prompt.get("messages") or []
        if not isinstance(messages, list):
            raise ValueError("MCP prompt result must include messages")

        system_overlays: list[dict[str, str]] = []
        injected_messages: list[dict[str, Any]] = []
        prompt_messages: list[JinjaMcpPromptMessage] = []

        for item in messages:
            if not isinstance(item, dict):
                raise ValueError("MCP prompt message must be an object")
            role = str(item.get("role") or "").strip()
            parts, preview, has_binary = McpResolver._normalize_content_blocks(
                content=item.get("content"),
                project_id=project_id,
            )
            if role == "system":
                if has_binary or any(part.get("type") != "content" for part in parts):
                    raise ValueError("system prompt message cannot contain non-text content")
                text = _collapse_text(parts)
                system_overlays.append(
                    {
                        "source_label": f"{server.display_name} / {selection.prompt_name}",
                        "text": text,
                    }
                )
            elif role in {"user", "assistant"}:
                injected_messages.append({"role": role, "content_parts": parts})
            else:
                raise ValueError("unsupported MCP prompt role")
            prompt_messages.append(
                JinjaMcpPromptMessage(
                    role=role,  # type: ignore[arg-type]
                    textPreview=preview,
                    hasBinary=has_binary,
                )
            )

        group = McpResolver._ensure_server_group(groups, server=server)
        group["prompts"].append(
            JinjaMcpPromptContext(
                name=selection.prompt_name,
                title=raw_prompt.get("title"),
                arguments=selection.arguments,
                messages=prompt_messages,
            ).model_dump(mode="json")
        )
        return (
            system_overlays,
            injected_messages,
            RunMcpAuditItem(
                selection_id=selection.selection_id,
                server_id=server.id,
                kind="prompt",
                source_label=server.display_name,
                summary_label=selection.prompt_name,
                raw_ref={"prompt_name": selection.prompt_name},
            ),
        )

    @staticmethod
    def _normalize_resource_result(
        *,
        raw_resource: dict[str, Any],
        server: McpServerModel,
        selection: McpSelectionResource,
        project_id: uuid.UUID,
        groups: dict[uuid.UUID, dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], RunMcpAuditItem]:
        contents = raw_resource.get("contents") or []
        if not isinstance(contents, list) or not contents:
            raise ValueError("MCP resource result must include contents")

        user_message_parts: list[dict[str, Any]] = []
        resource_contexts: list[JinjaMcpResourceContext] = []
        for item in contents:
            if not isinstance(item, dict):
                raise ValueError("MCP resource content must be an object")
            parts, ctx = McpResolver._normalize_resource_item(
                item=item,
                project_id=project_id,
                default_uri=selection.resource_uri,
            )
            user_message_parts.extend(parts)
            resource_contexts.append(ctx)

        group = McpResolver._ensure_server_group(groups, server=server)
        group["resources"].extend(ctx.model_dump(mode="json") for ctx in resource_contexts)
        return (
            user_message_parts,
            RunMcpAuditItem(
                selection_id=selection.selection_id,
                server_id=server.id,
                kind="resource",
                source_label=server.display_name,
                summary_label=selection.resource_uri,
                raw_ref={"resource_uri": selection.resource_uri},
            ),
        )

    async def resolve_selections(
        self,
        *,
        ctx: McpRuntimeContext,
        selections: list[McpSelection],
        project_id: uuid.UUID,
    ) -> RunMcpResolution:
        allowed_server_ids = mcp_policy_service.allowed_server_ids(ctx)
        requested_ids = {selection.server_id for selection in selections}
        if not requested_ids.issubset(allowed_server_ids):
            raise HTTPException(status_code=422, detail="MCP selection not allowed in this run")

        server_map = {
            row.id: row
            for row in (
                ctx.db.query(McpServerModel)
                .filter(
                    McpServerModel.user_id == ctx.user_id,
                    McpServerModel.preset_id == ctx.preset_id,
                    McpServerModel.id.in_(requested_ids) if requested_ids else False,
                )
                .all()
            )
        }
        groups: dict[uuid.UUID, dict[str, Any]] = {}
        resolution = _empty_resolution()
        resolution["tool_server_ids"] = [str(server_id) for server_id in McpResolver._tool_server_ids(ctx)]

        for selection in selections:
            server = server_map.get(selection.server_id)
            if server is None or server.secret is None:
                raise RuntimeError("MCP server not found")
            if isinstance(selection, McpSelectionPrompt):
                raw_prompt = await mcp_transport.get_prompt(server, server.secret, selection.prompt_name, selection.arguments)
                system_overlays, injected_messages, audit_item = McpResolver._normalize_prompt_result(
                    raw_prompt=raw_prompt,
                    server=server,
                    selection=selection,
                    project_id=project_id,
                    groups=groups,
                )
                resolution["system_overlays"].extend(system_overlays)
                resolution["injected_messages"].extend(injected_messages)
                resolution["audit"].append(audit_item.model_dump(mode="json"))
                continue
            if isinstance(selection, McpSelectionResource):
                raw_resource = await mcp_transport.read_resource(server, server.secret, selection.resource_uri)
                user_message_parts, audit_item = McpResolver._normalize_resource_result(
                    raw_resource=raw_resource,
                    server=server,
                    selection=selection,
                    project_id=project_id,
                    groups=groups,
                )
                resolution["user_message_parts"].extend(user_message_parts)
                resolution["audit"].append(audit_item.model_dump(mode="json"))
                continue
            raise RuntimeError("Unsupported MCP selection")

        resolution["template_contexts"] = list(groups.values())
        return RunMcpResolution.model_validate(resolution)

    async def execute_tool(
        self,
        *,
        db: Session,
        ctx: McpRuntimeContext,
        server_id: uuid.UUID,
        remote_name: str,
        arguments: dict[str, Any],
        project_id: uuid.UUID,
    ) -> dict[str, Any]:
        server = (
            db.query(McpServerModel)
            .filter(
                McpServerModel.id == server_id,
                McpServerModel.user_id == ctx.user_id,
                McpServerModel.preset_id == ctx.preset_id,
            )
            .first()
        )
        if server is None or server.secret is None:
            raise RuntimeError("MCP server not found")
        if server_id not in mcp_policy_service.allowed_server_ids(ctx):
            raise RuntimeError("MCP tool not allowed in this run")

        payload = await mcp_transport.call_tool(server, server.secret, remote_name, arguments, ctx)
        content_entries = payload.get("content") or []
        structured = payload.get("structuredContent")
        is_error = bool(payload.get("isError"))
        text_chunks: list[str] = []
        assets: list[dict[str, Any]] = []
        for item in content_entries if isinstance(content_entries, list) else []:
            if not isinstance(item, dict):
                continue
            block_type = str(item.get("type") or "").strip()
            if block_type == "text":
                text = str(item.get("text") or "")
                if text:
                    text_chunks.append(text)
                continue
            if block_type == "image":
                data_value = item.get("data")
                mime_type = str(item.get("mimeType") or "image/png")
                if not isinstance(data_value, str):
                    continue
                raw_bytes = base64.b64decode(data_value)
                filename = _guess_filename(item.get("name"), None, mime_type)
                asset = McpResolver._save_binary_part(
                    project_id=project_id,
                    filename=filename,
                    mime_type=mime_type,
                    raw_bytes=raw_bytes,
                )
                assets.append(asset)
                continue
            if block_type in {"resource", "embeddedResource"} or "blob" in item or "data" in item or "text" in item:
                parts, _ctx = McpResolver._normalize_resource_item(
                    item=item.get("resource") if block_type in {"resource", "embeddedResource"} and isinstance(item.get("resource"), dict) else item,
                    project_id=project_id,
                )
                for part in parts:
                    if part.get("type") == "content":
                        text = str(part.get("text") or "")
                        if text:
                            text_chunks.append(text)
                    else:
                        assets.append(part)
                continue
        text = "\n".join(chunk for chunk in text_chunks if chunk).strip() or remote_name
        result = {
            "success": not is_error,
            "message": text,
            "data": {
                "structured": structured,
            },
            "__extra_content": {
                "mcp": {
                    "structured": structured,
                    "assets": assets,
                }
            },
        }
        if is_error:
            result["error"] = text
        return result


def resolve_mcp_tool_name(tool_name: str, *, tool_specs: list[dict[str, Any]]) -> tuple[uuid.UUID, str]:
    for spec in tool_specs:
        if str(spec.get("local_name") or "") != tool_name:
            continue
        return uuid.UUID(str(spec["server_id"])), str(spec["remote_name"])
    raise RuntimeError("Unknown MCP tool")


mcp_secret_service = McpSecretService()
mcp_transport = McpTransport()
mcp_server_service = McpServerService()
mcp_sync_service = McpSyncService()
mcp_policy_service = McpPolicyService()
mcp_resolver = McpResolver()

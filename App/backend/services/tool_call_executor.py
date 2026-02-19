from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Callable
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import RunToolCallModel, SubAgentDefinitionModel, Thread
from ..services.credential_service import credential_service
from ..services.object_service import object_service
from ..services.patch_utils import apply_single_replacement
from ..services.rag_search_service import build_search_payload, keyword_search_project, search_project
from ..services.settings_service import settings_service


def _to_uuid(value: Any, field_name: str) -> UUID:
    try:
        return UUID(str(value))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Invalid {field_name}: {value}") from exc


def _content_to_doc(content: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": content}],
            }
        ],
    }


def _get_primary_object_id(db: Session, project_id: UUID, object_type: str) -> UUID:
    rows = object_service.list_objects(db, project_id=project_id, object_type=object_type)
    if not rows:
        raise ValueError(f"No {object_type} object found in project")
    return _to_uuid(rows[0]["id"], "id")


def _read_object(db: Session, project_id: UUID, object_type: str, object_id: UUID, language: str) -> dict[str, Any]:
    obj = object_service.get_object(db, object_type=object_type, object_id=object_id, project_id=project_id, language=language)
    if obj is None:
        raise ValueError(f"{object_type} not found: {object_id}")
    return obj


def _extract_lang_data(obj: dict[str, Any], language: str) -> dict[str, Any]:
    """Extract language-specific data from a serialized object."""
    data = obj.get("data", {})
    if isinstance(data.get(language), dict):
        return data[language]
    for v in data.values():
        if isinstance(v, dict):
            return v
    return {}


def _make_result(
    message: str,
    *,
    object_id: str | None = None,
    object_type: str | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an ApplicationResult-shaped dict for tool call results."""
    result: dict[str, Any] = {"success": True, "message": message}
    if object_id is not None:
        result["objectId"] = object_id
    if object_type is not None:
        result["objectType"] = object_type
    if data is not None:
        result["data"] = data
    return result


def _patch_object_data(current: dict[str, Any], args: dict[str, Any], *, is_manuscript: bool = False) -> dict[str, Any]:
    field = args.get("field")
    old = str(args.get("old") or "")
    new = str(args.get("new") or "")

    if is_manuscript:
        content = str(current.get("content") or "")
        result = apply_single_replacement(content, old, new)
        if not result.success:
            raise ValueError(result.reason or "Failed to patch manuscript")
        return {"doc": _content_to_doc(result.content), "wordCount": len(result.content.split())}

    if not isinstance(field, str) or not field.strip():
        raise ValueError("patch_* requires non-empty field")

    current_value = str(current.get(field) or "")
    result = apply_single_replacement(current_value, old, new)
    if not result.success:
        raise ValueError(result.reason or "Failed to patch field")

    updated = dict(current)
    updated[field] = result.content
    return updated


async def _execute_object_tool(
    db: Session,
    *,
    tool_name: str,
    args: dict[str, Any],
    user_id: UUID,
    project_id: UUID,
    language: str,
) -> tuple[dict[str, Any], list[dict[str, Any]], bool]:
    new_objects: list[dict[str, Any]] = []

    if tool_name == "create_story_object":
        object_type = str(args.get("type") or "")
        payload = {
            "name": str(args.get("name") or ""),
            "description": str(args.get("description") or ""),
            "content": str(args.get("content") or ""),
        }
        created = object_service.create_object(
            db,
            project_id=project_id,
            object_type=object_type,
            data=payload,
            language=language,
            user_request="tool:create_story_object",
            created_by=user_id,
        )
        new_objects.append(created)
        return (_make_result(f"Created {object_type}", object_id=created["id"], object_type=object_type), new_objects, False)

    if tool_name == "create_outline":
        payload = {
            "name": str(args.get("name") or ""),
            "description": str(args.get("description") or ""),
            "content": str(args.get("content") or ""),
        }
        created = object_service.create_object(
            db,
            project_id=project_id,
            object_type="outline",
            data=payload,
            language=language,
            user_request="tool:create_outline",
            created_by=user_id,
        )
        new_objects.append(created)
        return (_make_result("Created outline", object_id=created["id"], object_type="outline"), new_objects, False)

    if tool_name == "create_outline_act":
        payload = {
            "name": str(args.get("name") or ""),
            "description": str(args.get("description") or ""),
            "content": str(args.get("content") or ""),
        }
        created = object_service.create_object(
            db,
            project_id=project_id,
            object_type="act",
            data=payload,
            language=language,
            metadata={"outline_id": str(args.get("outlineId") or "")},
            user_request="tool:create_outline_act",
            created_by=user_id,
        )
        new_objects.append(created)
        return (_make_result("Created act", object_id=created["id"], object_type="act"), new_objects, False)

    if tool_name == "create_outline_chapter":
        payload = {
            "name": str(args.get("name") or ""),
            "description": str(args.get("description") or ""),
            "content": str(args.get("content") or ""),
        }
        created = object_service.create_object(
            db,
            project_id=project_id,
            object_type="chapter",
            data=payload,
            language=language,
            metadata={"act_id": str(args.get("actId") or "")},
            user_request="tool:create_outline_chapter",
            created_by=user_id,
        )
        new_objects.append(created)

        # Also sync the auto-created manuscript
        manuscript_id = created.get("metadata", {}).get("manuscript_id")
        if manuscript_id:
            manuscript = object_service.get_object(
                db, "manuscript", UUID(manuscript_id), project_id=project_id
            )
            if manuscript:
                new_objects.append(manuscript)

        return (
            _make_result("Created chapter", object_id=created["id"], object_type="chapter", data={"manuscriptId": manuscript_id}),
            new_objects,
            False,
        )

    if tool_name == "delete_story_object":
        object_id = _to_uuid(args.get("id"), "id")
        object_type = str(args.get("type") or "")
        object_service.delete_object(db, project_id=project_id, object_type=object_type, object_id=object_id, user_id=user_id)
        return (_make_result(f"Deleted {object_type}", object_id=str(object_id), object_type=object_type), new_objects, False)

    if tool_name == "delete_outline":
        object_id = _to_uuid(args.get("id"), "id")
        object_service.delete_object(db, project_id=project_id, object_type="outline", object_id=object_id, user_id=user_id)
        return (_make_result("Deleted outline", object_id=str(object_id), object_type="outline"), new_objects, False)

    if tool_name == "delete_outline_act":
        object_id = _to_uuid(args.get("id"), "id")
        object_service.delete_object(db, project_id=project_id, object_type="act", object_id=object_id, user_id=user_id)
        return (_make_result("Deleted act", object_id=str(object_id), object_type="act"), new_objects, False)

    if tool_name == "delete_outline_chapter":
        object_id = _to_uuid(args.get("id"), "id")
        object_service.delete_object(db, project_id=project_id, object_type="chapter", object_id=object_id, user_id=user_id)
        return (_make_result("Deleted chapter", object_id=str(object_id), object_type="chapter"), new_objects, False)

    if tool_name.startswith("replace_") or tool_name.startswith("patch_"):
        if tool_name.endswith("basic_info"):
            object_type = "basic_info"
            object_id = _get_primary_object_id(db, project_id, object_type)
        elif tool_name.endswith("guidelines"):
            object_type = "guidelines"
            object_id = _to_uuid(args.get("id"), "id")
        elif "story_object" in tool_name:
            object_type = str(args.get("type") or "")
            object_id = _to_uuid(args.get("id"), "id")
        elif tool_name.endswith("manuscript"):
            object_type = "manuscript"
            object_id = _to_uuid(args.get("id"), "id")
        elif tool_name.endswith("outline_act"):
            object_type = "act"
            object_id = _to_uuid(args.get("id"), "id")
        elif tool_name.endswith("outline_chapter"):
            object_type = "chapter"
            object_id = _to_uuid(args.get("id"), "id")
        else:
            object_type = "outline"
            object_id = _to_uuid(args.get("id"), "id")

        current = _read_object(db, project_id, object_type, object_id, language)
        lang_data = current.get("data", {}).get(language)
        if not isinstance(lang_data, dict):
            # fallback to any language present.
            values = [v for v in (current.get("data") or {}).values() if isinstance(v, dict)]
            lang_data = values[0] if values else {}

        if tool_name.startswith("replace_"):
            if object_type == "manuscript":
                next_data = {
                    "doc": _content_to_doc(str(args.get("content") or "")),
                    "wordCount": len(str(args.get("content") or "").split()),
                }
            else:
                next_data = dict(lang_data)
                for key in ["title", "logline", "genre", "name", "description", "content", "authorNote"]:
                    if key in args:
                        next_data[key] = args[key]

            metadata: dict[str, Any] = {}
            if object_type == "act" and isinstance(args.get("order"), int):
                metadata["order"] = int(args["order"])
            if object_type == "chapter":
                if isinstance(args.get("order"), int):
                    metadata["order"] = int(args["order"])
                if isinstance(args.get("actId"), str) and args.get("actId"):
                    metadata["act_id"] = args["actId"]

            updated = object_service.update_object(
                db,
                project_id=project_id,
                object_type=object_type,
                object_id=object_id,
                data=next_data,
                language=language,
                metadata=metadata or None,
                user_request=f"tool:{tool_name}",
                created_by=user_id,
            )
            new_objects.append(updated)
            return (_make_result(f"Replaced {object_type}", object_id=str(object_id), object_type=object_type), new_objects, False)

        # patch_
        next_data = _patch_object_data(lang_data, args, is_manuscript=(object_type == "manuscript"))
        metadata: dict[str, Any] = {}
        if object_type == "act" and isinstance(args.get("order"), int):
            metadata["order"] = int(args["order"])
        if object_type == "chapter":
            if isinstance(args.get("order"), int):
                metadata["order"] = int(args["order"])
            if isinstance(args.get("actId"), str) and args.get("actId"):
                metadata["act_id"] = args["actId"]

        updated = object_service.update_object(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            data=next_data,
            language=language,
            metadata=metadata or None,
            user_request=f"tool:{tool_name}",
            created_by=user_id,
        )
        new_objects.append(updated)
        return (_make_result(f"Patched {object_type}", object_id=str(object_id), object_type=object_type), new_objects, False)

    if tool_name == "read_story_object":
        object_type = str(args.get("type") or "")
        object_id = _to_uuid(args.get("id"), "id")
        obj = _read_object(db, project_id, object_type, object_id, language)
        lang_data = _extract_lang_data(obj, language)
        return (_make_result("Read successful", object_id=str(object_id), object_type=object_type, data={"object": lang_data}), new_objects, False)

    if tool_name == "read_outline":
        object_type = str(args.get("type") or "outline")
        object_id = _to_uuid(args.get("id"), "id")
        obj = _read_object(db, project_id, object_type, object_id, language)
        lang_data = _extract_lang_data(obj, language)
        return (_make_result("Read successful", object_id=str(object_id), object_type=object_type, data={"object": lang_data}), new_objects, False)

    if tool_name == "read_manuscript":
        object_id = _to_uuid(args.get("id"), "id")
        obj = _read_object(db, project_id, "manuscript", object_id, language)
        lang_data = _extract_lang_data(obj, language)
        return (_make_result("Read successful", object_id=str(object_id), object_type="manuscript", data={"object": lang_data}), new_objects, False)

    if tool_name == "keyword_search":
        keyword = str(args.get("keyword") or "").strip()
        page = int(args.get("page") or 1)
        page_size = 20
        raw = keyword_search_project(
            db,
            user_id=user_id,
            project_id=project_id,
            keyword=keyword,
            page=page,
            page_size=page_size,
        )
        total = raw.get("total", 0)
        grouped = build_search_payload(
            db,
            search_type="keyword",
            results=raw.get("results", []),
            language=language,
            keyword=keyword,
            page=page,
            page_size=page_size,
            total=total,
        )
        return (_make_result(f"Found {total} results for '{keyword}'", data={"searchPayload": grouped}), new_objects, False)

    if tool_name == "rag_search":
        queries = args.get("queries")
        if not isinstance(queries, list) or not all(isinstance(q, str) for q in queries):
            raise ValueError("rag_search requires queries: string[]")

        rag_cfg = settings_service.get_rag_settings(db, user_id)
        embed_cfg = settings_service.get_embedding_config(db, user_id, "ragSearch")
        provider_config = credential_service.get_provider_config(db, user_id, embed_cfg.provider)
        raw_results = await search_project(
            db,
            user_id=user_id,
            project_id=project_id,
            queries=queries,
            provider_config=provider_config,
            top_k_per_query=rag_cfg.top_k_per_query,
            neighbor_window=rag_cfg.neighbor_window,
        )
        grouped = build_search_payload(
            db,
            search_type="rag",
            results=raw_results,
            language=language,
            queries=queries,
            total=len(raw_results),
        )
        return (_make_result(f"Found {len(raw_results)} results", data={"searchPayload": grouped}), new_objects, False)

    raise ValueError(f"Unsupported tool: {tool_name}")


async def _execute_sub_agent(
    db: Session,
    *,
    tool_call: RunToolCallModel,
    user_id: UUID,
    project_id: UUID,
) -> dict[str, Any]:
    tool_name = str(tool_call.tool_name)
    agent_name = tool_name[5:] if tool_name.startswith("call_") else ""
    if not agent_name:
        raise ValueError(f"Invalid sub-agent tool name: {tool_name}")

    preset_id = settings_service.get_active_preset_id(db, user_id)
    if preset_id is None:
        raise ValueError("No active preset configured")

    definition = (
        db.query(SubAgentDefinitionModel)
        .filter(
            SubAgentDefinitionModel.user_id == user_id,
            SubAgentDefinitionModel.preset_id == preset_id,
            SubAgentDefinitionModel.agent_name == agent_name,
            SubAgentDefinitionModel.enabled == True,
        )
        .first()
    )
    if definition is None:
        raise ValueError(f"Sub-agent not found: {agent_name}")

    child_thread = Thread(
        project_id=project_id,
        user_id=user_id,
        thread_type="subAgent",
        owner_id=definition.id,
        status="waiting",
    )
    db.add(child_thread)
    db.flush()

    tool_call.child_thread_id = child_thread.id
    tool_call.status = "processing"
    tool_call.result = {
        "child_thread_id": str(child_thread.id),
        "agent_name": agent_name,
    }
    tool_call.updated_at = datetime.utcnow()
    db.flush()

    # Build input text from tool call arguments for the child run
    args = tool_call.arguments if isinstance(tool_call.arguments, dict) else {}
    input_text = args.get("input") or args.get("task") or ""
    if not input_text:
        input_text = json.dumps(args, ensure_ascii=False)

    return {
        "child_thread_id": str(child_thread.id),
        "agent_name": agent_name,
        "input_text": input_text,
    }


async def execute(
    db_factory: Callable[[], Session],
    tool_call_id: UUID,
    *,
    user_id: UUID,
    project_id: UUID,
    language: str,
) -> dict[str, Any]:
    db = db_factory()
    try:
        tool_call = db.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
        if tool_call is None:
            raise ValueError("Tool call not found")

        if tool_call.status in {"applied", "failed", "rejected"}:
            return {
                "tool_call": tool_call,
                "new_objects": [],
            }

        tool_call.status = "processing"
        tool_call.accepted_at = tool_call.accepted_at or datetime.utcnow()
        tool_call.updated_at = datetime.utcnow()
        db.flush()

        if tool_call.tool_name.startswith("call_"):
            result = await _execute_sub_agent(
                db,
                tool_call=tool_call,
                user_id=user_id,
                project_id=project_id,
            )
            db.commit()
            db.refresh(tool_call)
            return {
                "tool_call": tool_call,
                "new_objects": [],
                "result": result,
            }

        args = tool_call.arguments if isinstance(tool_call.arguments, dict) else {}
        result, new_objects, _ = await _execute_object_tool(
            db,
            tool_name=tool_call.tool_name,
            args=args,
            user_id=user_id,
            project_id=project_id,
            language=language,
        )

        tool_call.status = "applied"
        tool_call.result = result
        tool_call.reason = None
        tool_call.updated_at = datetime.utcnow()
        db.flush()
        db.commit()
        db.refresh(tool_call)

        return {
            "tool_call": tool_call,
            "new_objects": new_objects,
            "result": result,
        }

    except Exception as exc:  # noqa: BLE001
        db.rollback()
        row = db.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
        if row is not None:
            row.status = "failed"
            row.reason = str(exc)
            row.result = {"success": False, "message": str(exc), "error": str(exc)}
            row.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(row)
            return {
                "tool_call": row,
                "new_objects": [],
                "result": row.result,
            }
        raise
    finally:
        db.close()

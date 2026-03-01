from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunToolCallModel


TERMINAL_TOOL_STATUSES = {"applied", "failed", "rejected"}


def _resolve_lang_entry(data: dict[str, Any], language: str) -> dict[str, Any]:
    if isinstance(data.get(language), dict):
        return data[language]
    for value in data.values():
        if isinstance(value, dict):
            return value
    return {"contentParts": []}


def _normalize_content_parts(entry: dict[str, Any]) -> list[dict[str, str]]:
    parts = entry.get("contentParts") if isinstance(entry, dict) else []
    if not isinstance(parts, list):
        return []

    out: list[dict[str, str]] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        ptype = str(part.get("type") or "")
        if ptype != "content":
            continue
        text = part.get("text")
        if not isinstance(text, str):
            continue
        out.append({"type": "content", "text": text})
    return out


def _to_xml_string(root: ET.Element) -> str:
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")


def _format_search_result_xml(result: dict[str, Any]) -> str:
    data = result.get("data") or {}
    payload = data.get("searchPayload") or {}

    root = ET.Element("search_result", type=str(payload.get("type", "rag")), total=str(payload.get("total", 0)))
    for group in payload.get("groups", []):
        if not isinstance(group, dict):
            continue
        obj_el = ET.SubElement(root, "object",
            type=str(group.get("objectType", "")),
            id=str(group.get("objectId", "")),
            displayName=str(group.get("displayName", "")),
        )
        for entry in group.get("entries", []):
            if not isinstance(entry, dict):
                continue
            attrs: dict[str, str] = {}
            field = entry.get("fieldPath")
            if field:
                attrs["field"] = str(field)
            result_el = ET.SubElement(obj_el, "result", **attrs)
            result_el.text = str(entry.get("text", ""))
    return _to_xml_string(root)


def _format_read_result_xml(result: dict[str, Any]) -> str:
    root = ET.Element("read_result",
        type=str(result.get("objectType", "")),
        id=str(result.get("objectId", "")),
    )
    data = result.get("data") or {}
    obj = data.get("object") or {}
    for key in ("name", "title", "logline", "genre", "description", "content", "authorNote"):
        value = obj.get(key)
        if isinstance(value, str) and value.strip():
            child = ET.SubElement(root, key)
            child.text = value
    return _to_xml_string(root)


def _format_result_content(result: dict[str, Any], tool_name: str) -> str:
    """Format an ApplicationResult dict as structured XML for LLM consumption."""
    success = result.get("success", True)
    if not success:
        error = str(result.get("error") or result.get("message") or "Unknown error")
        root = ET.Element("tool_result", status="failed")
        root.text = error
        return _to_xml_string(root)

    # Search results
    data = result.get("data") or {}
    if data.get("searchPayload"):
        return _format_search_result_xml(result)

    # Read results
    if data.get("object") and tool_name.startswith("read_"):
        return _format_read_result_xml(result)

    # CRUD confirmations
    attrs: dict[str, str] = {"status": "success"}
    ot = result.get("objectType")
    oid = result.get("objectId")
    if ot:
        attrs["type"] = str(ot)
    if oid:
        attrs["id"] = str(oid)
    for key, val in data.items():
        if isinstance(val, str) and val:
            attrs[key] = val
    root = ET.Element("tool_result", **attrs)
    root.text = str(result.get("message") or "")
    return _to_xml_string(root)


def _tool_result_from_tool_call(tool: RunToolCallModel) -> dict[str, Any] | None:
    result = tool.result
    tool_name = str(tool.tool_name or "")

    if isinstance(result, dict) and result:
        content = _format_result_content(result, tool_name)
    elif tool.reason or tool.status:
        content = str(tool.reason or tool.status or "")
    else:
        return None

    if not content.strip():
        return None

    # Provider tool-response matching expects the original LLM call ID.
    llm_tool_call_id = str(getattr(tool, "llm_call_id", "") or "").strip()
    if not llm_tool_call_id:
        llm_tool_call_id = str(tool.id)
    return {
        "tool_call_id": llm_tool_call_id,
        "tool_name": tool_name or "tool_result",
        "content": content,
    }


def build_from_runs(
    db: Session,
    thread_id: UUID,
    language: str,
    include_run_ids: list[UUID] | None = None,
) -> list[dict[str, Any]]:
    q = db.query(RunMessageModel).filter(RunMessageModel.thread_id == thread_id)
    if include_run_ids is not None:
        q = q.filter(RunMessageModel.run_id.in_(include_run_ids))

    rows = q.order_by(RunMessageModel.seq_in_thread.asc(), RunMessageModel.created_at.asc()).all()
    if not rows:
        return []

    # Tool calls are looked up by assistant_message_id and attached to assistant turns.
    assistant_ids = [row.id for row in rows if row.role == "assistant"]
    tool_calls_by_assistant: dict[UUID, list[RunToolCallModel]] = {}
    terminal_tools_by_assistant: dict[UUID, list[RunToolCallModel]] = {}
    if assistant_ids:
        tool_rows = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.assistant_message_id.in_(assistant_ids))
            .order_by(RunToolCallModel.call_seq.asc())
            .all()
        )
        for tool in tool_rows:
            if tool.assistant_message_id is None:
                continue
            tool_calls_by_assistant.setdefault(tool.assistant_message_id, []).append(tool)
            if tool.status in TERMINAL_TOOL_STATUSES:
                terminal_tools_by_assistant.setdefault(tool.assistant_message_id, []).append(tool)

    conversation: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row.data, dict):
            continue
        entry = _resolve_lang_entry(row.data, language)

        if row.role in {"system", "user", "assistant"}:
            content_parts = _normalize_content_parts(entry)

            msg: dict[str, Any] = {
                "role": row.role,
                "content_parts": content_parts,
                "run_id": str(row.run_id),
                "seq_in_thread": int(row.seq_in_thread) if row.seq_in_thread is not None else None,
            }
            if msg["seq_in_thread"] is None:
                msg.pop("seq_in_thread", None)

            if row.role == "assistant":
                reasoning_detail = entry.get("reasoningDetail")
                if isinstance(reasoning_detail, dict):
                    msg["reasoning_detail"] = reasoning_detail

            if row.role == "assistant":
                tool_calls = []
                for tool in tool_calls_by_assistant.get(row.id, []):
                    item = {
                        "id": tool.llm_call_id,
                        "type": "function",
                        "function": {
                            "name": tool.tool_name,
                            "arguments": json.dumps(tool.arguments if isinstance(tool.arguments, dict) else {}, ensure_ascii=False),
                        },
                    }
                    if isinstance(getattr(tool, "extra_content", None), dict):
                        item["extra_content"] = tool.extra_content
                    tool_calls.append(item)
                if tool_calls:
                    msg["tool_calls"] = tool_calls

            conversation.append(msg)

            if row.role == "assistant":
                payloads = []
                for tool in terminal_tools_by_assistant.get(row.id, []):
                    payload = _tool_result_from_tool_call(tool)
                    if payload is not None:
                        payloads.append(payload)
                if payloads:
                    conversation.append(
                        {
                            "role": "tool_results",
                            "content_parts": [],
                            "tool_results": payloads,
                            "run_id": str(row.run_id),
                            "seq_in_thread": int(row.seq_in_thread) if row.seq_in_thread is not None else None,
                        }
                    )
            continue

    return conversation

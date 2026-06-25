from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import Asset, RunMessageAttachmentModel, RunMessageModel, RunToolCallModel
from ...providers.shared.parsing.multimodal import attachment_to_content_part


TERMINAL_TOOL_STATUSES = {"applied", "failed", "rejected"}


def _resolve_lang_entry(data: dict[str, Any], language: str) -> dict[str, Any]:
    if isinstance(data.get(language), dict):
        return data[language]
    for value in data.values():
        if isinstance(value, dict):
            return value
    return {"contentParts": []}


def _normalize_content_parts(entry: dict[str, Any]) -> list[dict[str, Any]]:
    parts = entry.get("contentParts") if isinstance(entry, dict) else []
    if not isinstance(parts, list):
        return []

    out: list[dict[str, Any]] = []
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
    raw_data = result.get("data")
    data = raw_data if isinstance(raw_data, dict) else {}
    payload = data.get("searchPayload") or {}

    root = ET.Element("search_result", type=str(payload.get("type", "semantic")), total=str(payload.get("total", 0)))
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


def _append_scalar_fields(root: ET.Element, obj: dict[str, Any], keys: tuple[str, ...]) -> None:
    for key in keys:
        if key not in obj:
            continue
        child = ET.SubElement(root, key)
        value = obj.get(key)
        if value is not None:
            child.text = str(value)


def _append_timeline_id_list(root: ET.Element, obj: dict[str, Any], key: str) -> None:
    if key not in obj:
        return
    container = ET.SubElement(root, key)
    values = obj.get(key)
    if not isinstance(values, list):
        return
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        child = ET.SubElement(container, "id")
        child.text = text


def _append_timeline_date(root: ET.Element, obj: dict[str, Any], key: str) -> None:
    if key not in obj:
        return
    child = ET.SubElement(root, key)
    value = obj.get(key)
    if isinstance(value, dict):
        child.text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _append_timeline_links(root: ET.Element, obj: dict[str, Any]) -> None:
    if "links" not in obj:
        return
    links_el = ET.SubElement(root, "links")
    links = obj.get("links")
    if not isinstance(links, list):
        return
    for link in links:
        if not isinstance(link, dict):
            continue
        attrs = {
            key: str(value)
            for key, value in (
                ("linkId", link.get("linkId")),
                ("objectType", link.get("objectType")),
                ("objectId", link.get("objectId")),
            )
            if value is not None and str(value)
        }
        ET.SubElement(links_el, "link", **attrs)


def _xml_attrs(obj: dict[str, Any], keys: tuple[str, ...]) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for key in keys:
        if key in obj and obj.get(key) is not None:
            attrs[key] = str(obj.get(key))
    return attrs


def _format_read_result_xml(result: dict[str, Any]) -> str:
    object_type = str(result.get("objectType", ""))
    raw_data = result.get("data")
    data = raw_data if isinstance(raw_data, dict) else {}
    raw_obj = data.get("object")
    obj = raw_obj if isinstance(raw_obj, dict) else {}
    root_attrs = {
        "type": object_type,
        "id": str(result.get("objectId", "")),
    }
    if object_type in {"outline", "story_entity"}:
        kind = obj.get("kind")
        if kind is not None and str(kind):
            root_attrs["kind"] = str(kind)
    root = ET.Element("read_result", **root_attrs)
    for key in ("name", "title", "logline", "description", "content", "authorNote"):
        value = obj.get(key)
        if isinstance(value, str) and value.strip():
            child = ET.SubElement(root, key)
            child.text = value
    genres = obj.get("genres")
    if isinstance(genres, list):
        genres_el = ET.SubElement(root, "genres")
        for value in genres:
            text = str(value or "").strip()
            if not text:
                continue
            child = ET.SubElement(genres_el, "genre")
            child.text = text
        if len(genres_el) == 0:
            root.remove(genres_el)
    tags = obj.get("tags")
    if isinstance(tags, list):
        tags_el = ET.SubElement(root, "tags")
        for value in tags:
            text = str(value or "").strip()
            if not text:
                continue
            child = ET.SubElement(tags_el, "tag")
            child.text = text
        if len(tags_el) == 0:
            root.remove(tags_el)
    if object_type == "timeline_track":
        _append_scalar_fields(root, obj, ("parentId", "position", "color"))
        _append_timeline_id_list(root, obj, "childTrackIds")
        _append_timeline_id_list(root, obj, "eventIds")
    elif object_type == "timeline_event":
        _append_scalar_fields(root, obj, ("trackId",))
        _append_timeline_date(root, obj, "startDate")
        _append_timeline_date(root, obj, "endDate")
        _append_timeline_links(root, obj)
    elif object_type == "story_entity_folder":
        _append_scalar_fields(root, obj, ("parentId", "position"))
    return _to_xml_string(root)


def _append_project_tree_story_nodes(parent: ET.Element, nodes: Any) -> None:
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("nodeType") or "")
        if node_type == "folder":
            folder_el = ET.SubElement(parent, "folder", **_xml_attrs(node, ("id", "name")))
            _append_project_tree_story_nodes(folder_el, node.get("children"))
        elif node_type == "entity":
            ET.SubElement(parent, "entity", **_xml_attrs(node, ("id", "name", "kind")))


def _append_project_tree_outline_nodes(parent: ET.Element, nodes: Any) -> None:
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict):
            continue
        attrs = _xml_attrs(
            node,
            ("id", "kind", "name", "actNumber", "chapterNumber", "manuscriptId"),
        )
        item_el = ET.SubElement(parent, "item", **attrs)
        _append_project_tree_outline_nodes(item_el, node.get("children"))


def _append_project_tree_timeline_tracks(parent: ET.Element, tracks: Any) -> None:
    if not isinstance(tracks, list):
        return
    for track in tracks:
        if not isinstance(track, dict):
            continue
        track_el = ET.SubElement(
            parent,
            "track",
            **_xml_attrs(track, ("id", "name", "eventCount", "position")),
        )
        _append_project_tree_timeline_tracks(track_el, track.get("children"))


def _format_project_tree_result_xml(result: dict[str, Any]) -> str:
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    tree = data.get("tree") if isinstance(data, dict) else None
    if not isinstance(tree, dict):
        return ""

    root = ET.Element("project_tree")
    title = tree.get("title")
    if isinstance(title, str) and title.strip():
        title_el = ET.SubElement(root, "title")
        title_el.text = title

    story_entities_el = ET.SubElement(root, "story_entities")
    _append_project_tree_story_nodes(story_entities_el, tree.get("storyEntities"))

    outline_el = ET.SubElement(root, "outline")
    _append_project_tree_outline_nodes(outline_el, tree.get("outline"))

    timeline_el = ET.SubElement(root, "timeline")
    timeline = tree.get("timeline")
    tracks = timeline.get("tracks") if isinstance(timeline, dict) else []
    _append_project_tree_timeline_tracks(timeline_el, tracks)

    return _to_xml_string(root)


def _is_scalar_payload_value(value: Any) -> bool:
    return (isinstance(value, str) and bool(value)) or isinstance(value, (int, float, bool))


def _format_result_content(result: dict[str, Any], tool_name: str) -> str:
    """Format an ApplicationResult dict as structured XML for LLM consumption."""
    success = result.get("success", True)
    if not success:
        error = str(result.get("error") or result.get("message") or "Unknown error")
        root = ET.Element("tool_result", status="failed")
        root.text = error
        return _to_xml_string(root)

    # Search results
    raw_data = result.get("data")
    data = raw_data if isinstance(raw_data, dict) else {}
    if data.get("searchPayload"):
        return _format_search_result_xml(result)

    if tool_name == "get_project_tree" and isinstance(data.get("tree"), dict):
        return _format_project_tree_result_xml(result)

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
        if _is_scalar_payload_value(val):
            attrs[key] = str(val)
    root = ET.Element("tool_result", **attrs)
    message = str(result.get("message") or "")
    has_payload = any(isinstance(val, (dict, list)) for val in data.values())
    if has_payload and message:
        message_el = ET.SubElement(root, "message")
        message_el.text = message
    for key, val in data.items():
        if isinstance(val, (dict, list)):
            payload = ET.SubElement(root, "payload", key=str(key))
            payload.text = json.dumps(val, ensure_ascii=False, separators=(",", ":"))
    if not has_payload:
        root.text = message
    return _to_xml_string(root)


def _build_asset_image_part(db: Session, asset_id_raw: Any) -> dict[str, Any] | None:
    asset_id_str = str(asset_id_raw or "").strip()
    if not asset_id_str:
        return None
    try:
        asset_id = UUID(asset_id_str)
    except (ValueError, TypeError):
        return None
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if asset is None:
        return None
    mime_type = str(asset.mime_type or "").strip()
    file_path = str(asset.file_path or "").strip()
    if not file_path or not mime_type.startswith("image/"):
        return None
    return {
        "type": "image",
        "source": "asset",
        "mime_type": mime_type,
        "storage_key": file_path,
        "filename": str(asset.name or "") or "image",
        "asset_id": str(asset.id),
    }


def _tool_result_image_parts(db: Session, result: Any) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    data = result.get("data")
    asset_ids = data.get("image_asset_ids") if isinstance(data, dict) else None
    if not isinstance(asset_ids, list):
        return []
    parts: list[dict[str, Any]] = []
    for asset_id in asset_ids:
        part = _build_asset_image_part(db, asset_id)
        if part is not None:
            parts.append(part)
    return parts


def _tool_result_from_tool_call(db: Session, tool: RunToolCallModel) -> dict[str, Any] | None:
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
    payload: dict[str, Any] = {
        "tool_call_id": llm_tool_call_id,
        "tool_name": tool_name or "tool_result",
        "content": content,
    }
    image_parts = _tool_result_image_parts(db, result)
    if image_parts:
        payload["image_parts"] = image_parts
    return payload


def build_from_runs(
    db: Session,
    thread_id: UUID,
    language: str,
    include_run_ids: list[UUID] | None = None,
    archived_until_seq_in_thread: int | None = None,
) -> list[dict[str, Any]]:
    q = db.query(RunMessageModel).filter(RunMessageModel.thread_id == thread_id)
    if include_run_ids is not None:
        q = q.filter(RunMessageModel.run_id.in_(include_run_ids))
    if archived_until_seq_in_thread is not None:
        q = q.filter(RunMessageModel.seq_in_thread > int(archived_until_seq_in_thread))

    rows = q.order_by(RunMessageModel.seq_in_thread.asc(), RunMessageModel.created_at.asc()).all()
    if not rows:
        return []

    # Tool calls are looked up by assistant_message_id and attached to assistant turns.
    assistant_ids = [row.id for row in rows if row.role == "assistant"]
    message_ids = [row.id for row in rows if isinstance(row.id, UUID)]
    tool_calls_by_assistant: dict[UUID, list[RunToolCallModel]] = {}
    terminal_tools_by_assistant: dict[UUID, list[RunToolCallModel]] = {}
    attachments_by_message: dict[UUID, list[RunMessageAttachmentModel]] = {}
    if message_ids:
        attachment_rows = (
            db.query(RunMessageAttachmentModel)
            .filter(RunMessageAttachmentModel.message_id.in_(message_ids))
            .order_by(RunMessageAttachmentModel.message_id.asc(), RunMessageAttachmentModel.sort_order.asc())
            .all()
        )
        for attachment in attachment_rows:
            attachments_by_message.setdefault(attachment.message_id, []).append(attachment)
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
            content_parts.extend(
                attachment_to_content_part(attachment)
                for attachment in attachments_by_message.get(row.id, [])
            )

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
                    payload = _tool_result_from_tool_call(db, tool)
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

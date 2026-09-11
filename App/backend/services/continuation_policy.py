"""Browser-independent equivalents of the existing all-or-none UX rules."""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

UNRESOLVED_TOOL_STATUSES = frozenset({"streaming", "validating", "pending", "processing", "working"})
STOPPED_RUN_STATUSES = frozenset({"paused", "canceled", "error"})


def tool_category(tool: Any) -> str:
    extra = tool.extra_content if isinstance(tool.extra_content, dict) else {}
    meta = extra.get("__tool_meta")
    if isinstance(meta, dict) and isinstance(meta.get("category"), str) and meta["category"]:
        return meta["category"]
    name = str(tool.tool_name)
    if name.startswith(("read_", "search_")) or name == "get_project_tree":
        return "read"
    if name.startswith("delete_"):
        return "delete"
    if name.startswith(("translate_", "patch_translation_")):
        return "translate"
    if name.startswith("call_"):
        return "sub_agent"
    if name.startswith("generate_"):
        return "generate"
    if name.startswith("mcp__"):
        return "mcp"
    return "write"


def auto_approval_ids(tools: Iterable[Any], config: Mapping[str, Any]) -> list[Any]:
    pending = [tool for tool in tools if tool.status == "pending"]
    if pending and all(bool(config.get(tool_category(tool), False)) for tool in pending):
        return [tool.id for tool in pending]
    return []


def can_continue(*, status: str, tools: Iterable[Any], unresolved: bool) -> bool:
    calls = list(tools)
    return (
        status not in STOPPED_RUN_STATUSES | {"running"}
        and bool(calls)
        and not unresolved
        and not any(tool.tool_name == "submit_image_prompt" for tool in calls)
        and all(tool.status in {"applied", "failed"} for tool in calls)
    )

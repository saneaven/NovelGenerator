from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolOfferContext, ToolValidationContext
from ..contracts import ToolSpec
from ..registry import ToolRegistry
from ..result_utils import invalid_result, make_result, valid_result
from .common_object_helpers import obj_schema
from ....services.credential_service import credential_service
from ....services.rag_search_service import build_search_payload, keyword_search_project, search_project
from ....services.settings_service import settings_service


def _validate_keyword_search(args: dict[str, Any], ctx: ToolValidationContext):
    keyword = args.get("keyword")
    if not isinstance(keyword, str) or not keyword.strip():
        return invalid_result("validate_keyword_search", "keyword must be a non-empty string")

    page = args.get("page")
    if page is not None and (not isinstance(page, int) or page < 1):
        return invalid_result("validate_keyword_search", "page must be a positive integer")

    if not settings_service.is_vector_storage_enabled(ctx.db, ctx.user_id):
        return invalid_result("validate_keyword_search", "Vector storage is disabled (Settings > Search & Memory)")

    return valid_result()


def _validate_rag_search(args: dict[str, Any], ctx: ToolValidationContext):
    queries = args.get("queries")
    if not isinstance(queries, list) or len(queries) == 0 or not all(isinstance(q, str) and q.strip() for q in queries):
        return invalid_result("validate_rag_search", "queries must be non-empty string[]")

    if not settings_service.is_vector_storage_enabled(ctx.db, ctx.user_id):
        return invalid_result("validate_rag_search", "Vector storage is disabled (Settings > Search & Memory)")

    return valid_result()


async def _execute_keyword_search(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    keyword = str(args.get("keyword") or "").strip()
    page = int(args.get("page") or 1)
    page_size = 20

    raw = keyword_search_project(
        ctx.db,
        user_id=ctx.user_id,
        project_id=ctx.project_id,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )
    total = raw.get("total", 0)
    grouped = build_search_payload(
        ctx.db,
        search_type="keyword",
        results=raw.get("results", []),
        language=ctx.language,
        keyword=keyword,
        page=page,
        page_size=page_size,
        total=total,
    )
    return make_result(f"Found {total} results for '{keyword}'", data={"searchPayload": grouped})


async def _execute_rag_search(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    queries = args.get("queries")
    if not isinstance(queries, list) or not all(isinstance(q, str) for q in queries):
        raise ValueError("rag_search requires queries: string[]")

    rag_cfg = settings_service.get_rag_settings(ctx.db, ctx.user_id)
    embed_cfg = settings_service.get_embedding_config(ctx.db, ctx.user_id, "ragSearch")
    provider_config = credential_service.get_provider_config(ctx.db, ctx.user_id, embed_cfg.provider)

    raw_results = await search_project(
        ctx.db,
        user_id=ctx.user_id,
        project_id=ctx.project_id,
        queries=queries,
        provider_config=provider_config,
        top_k_per_query=rag_cfg.top_k_per_query,
        neighbor_window=rag_cfg.neighbor_window,
    )

    grouped = build_search_payload(
        ctx.db,
        search_type="rag",
        results=raw_results,
        language=ctx.language,
        queries=queries,
        total=len(raw_results),
    )
    return make_result(f"Found {len(raw_results)} results", data={"searchPayload": grouped})


def _vector_storage_enabled(ctx: ToolOfferContext) -> bool:
    return bool(ctx.vector_storage_enabled)


def register(registry: ToolRegistry) -> None:
    registry.register_tool(
        ToolSpec(
            name="keyword_search",
            description="Search by keyword in project knowledge base.",
            parameters=obj_schema({"keyword": {"type": "string"}, "page": {"type": "integer"}}, ["keyword"]),
            tool_sets=frozenset({"agent_agent_mode", "agent_plan_mode"}),
            auto_approve_category="search",
            validators=(_validate_keyword_search,),
            executor=_execute_keyword_search,
            enabled_when=_vector_storage_enabled,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="rag_search",
            description="Search by embeddings in project knowledge base.",
            parameters=obj_schema({"queries": {"type": "array", "items": {"type": "string"}}}, ["queries"]),
            tool_sets=frozenset({"agent_agent_mode", "agent_plan_mode"}),
            auto_approve_category="search",
            validators=(_validate_rag_search,),
            executor=_execute_rag_search,
            enabled_when=_vector_storage_enabled,
        )
    )

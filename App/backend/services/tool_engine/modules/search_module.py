from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.credential_service import credential_service
from ....services.semantic_search_service import build_search_payload, search_project, search_project_by_keyword
from ....services.settings_service import settings_service
from .shared import filter_allowed_specs, is_non_journey, obj_schema


@tool_call_module(prefix="search_")
class SearchToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("search",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not is_non_journey(ctx) or not ctx.vector_storage_enabled:
            return []
        return filter_allowed_specs(
            ctx,
            [
                ToolSpec(
                    name="search_keyword",
                    description="Search by keyword in project knowledge base.",
                    parameters=obj_schema({"keyword": {"type": "string"}, "page": {"type": "integer"}}, ["keyword"]),
                    auto_approve_category="search",
                ),
                ToolSpec(
                    name="search_semantic",
                    description="Semantic search in the project knowledge base.",
                    parameters=obj_schema({"queries": {"type": "array", "items": {"type": "string"}}}, ["queries"]),
                    auto_approve_category="search",
                ),
            ],
        )

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        if not ctx.vector_storage_enabled:
            return invalid_result(f"validate_{tool_name}", "Search & Memory is disabled (Settings > Search & Memory)")

        if tool_name == "search_keyword":
            keyword = args.get("keyword")
            if not isinstance(keyword, str) or not keyword.strip():
                return invalid_result("validate_search_keyword", "keyword must be a non-empty string")
            page = args.get("page")
            if page is not None and (not isinstance(page, int) or page < 1):
                return invalid_result("validate_search_keyword", "page must be a positive integer")
            return valid_result()

        if tool_name == "search_semantic":
            queries = args.get("queries")
            if not isinstance(queries, list) or len(queries) == 0 or not all(isinstance(q, str) and q.strip() for q in queries):
                return invalid_result("validate_search_semantic", "queries must be non-empty string[]")
            return valid_result()

        return invalid_result("validate_search_tool_name", f"Unsupported search tool: {tool_name}")

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        if tool_name == "search_keyword":
            keyword = str(args.get("keyword") or "").strip()
            page = int(args.get("page") or 1)
            search_cfg = settings_service.get_search_settings(ctx.db, ctx.user_id)
            page_size = search_cfg.keyword_page_size
            raw = search_project_by_keyword(
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

        if tool_name == "search_semantic":
            queries = args.get("queries")
            if not isinstance(queries, list) or not all(isinstance(q, str) for q in queries):
                raise ValueError("search_semantic requires queries: string[]")
            search_cfg = settings_service.get_search_settings(ctx.db, ctx.user_id)
            provider_config = credential_service.get_provider_config(ctx.db, ctx.user_id, search_cfg.embedding.provider)
            raw_results = await search_project(
                ctx.db,
                user_id=ctx.user_id,
                project_id=ctx.project_id,
                queries=queries,
                provider_config=provider_config,
                top_k_per_query=search_cfg.retrieval.top_k_per_query,
                neighbor_window=search_cfg.retrieval.neighbor_window,
                max_primary_items=search_cfg.retrieval.max_primary_items,
                max_total_items=search_cfg.retrieval.max_total_items,
            )
            grouped = build_search_payload(
                ctx.db,
                search_type="semantic",
                results=raw_results,
                language=ctx.language,
                queries=queries,
                total=len(raw_results),
            )
            return make_result(f"Found {len(raw_results)} results", data={"searchPayload": grouped})

        raise ValueError(f"Unsupported search tool: {tool_name}")

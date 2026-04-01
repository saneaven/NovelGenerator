from __future__ import annotations

from ..contracts import PersistedToolMeta, ToolBinding, ToolBindingMeta, ToolExecutionOutcome, ToolFeatureModule, ToolSpec
from ..registry import tool_feature_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.credential_service import credential_service
from ....services.semantic_search_service import build_search_payload, search_project, search_project_by_regex
from ....services.settings_service import settings_service
from .feature_common import filter_allowed_bindings
from .shared import filter_allowed_specs, is_non_journey, obj_schema


def _search_specs(ctx) -> list[ToolSpec]:
    if not is_non_journey(ctx) or not ctx.vector_storage_enabled:
        return []
    return filter_allowed_specs(
        ctx,
        [
            ToolSpec(
                name="search_regex",
                description="Search by regex in the project knowledge base.",
                parameters=obj_schema(
                    {
                        "pattern": {"type": "string"},
                        "page": {"type": "integer"},
                        "case_sensitive": {"type": "boolean"},
                    },
                    ["pattern"],
                ),
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


def _persisted_meta() -> PersistedToolMeta:
    return PersistedToolMeta(
        feature_key="search",
        category="read",
        op="search",
        target_kind="project_tree",
        target_id=None,
        merge_key=None,
    )


@tool_feature_module()
class SearchFeatureModule(ToolFeatureModule):
    feature_key = "search"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        bindings: list[ToolBinding] = []
        for spec in _search_specs(ctx):
            tool_name = spec.name

            async def _validate(args, validation_ctx, _tool_name=tool_name):
                if not validation_ctx.vector_storage_enabled:
                    return invalid_result(
                        f"validate_{_tool_name}",
                        "Search & Memory is disabled (Settings > Search & Memory)",
                    )

                if _tool_name == "search_regex":
                    pattern = args.get("pattern")
                    if not isinstance(pattern, str) or not pattern.strip():
                        return invalid_result("validate_search_regex", "pattern must be a non-empty string")
                    page = args.get("page")
                    if page is not None and (not isinstance(page, int) or page < 1):
                        return invalid_result("validate_search_regex", "page must be a positive integer")
                    return valid_result()

                queries = args.get("queries")
                if not isinstance(queries, list) or len(queries) == 0 or not all(isinstance(q, str) and q.strip() for q in queries):
                    return invalid_result("validate_search_semantic", "queries must be non-empty string[]")
                return valid_result()

            async def _execute(args, execution_ctx, _tool_name=tool_name):
                if _tool_name == "search_regex":
                    pattern = str(args.get("pattern") or "").strip()
                    case_sensitive = args.get("case_sensitive") is True
                    page = int(args.get("page") or 1)
                    search_cfg = settings_service.get_search_settings(execution_ctx.db, execution_ctx.user_id)
                    page_size = search_cfg.regex_page_size
                    raw = search_project_by_regex(
                        execution_ctx.db,
                        user_id=execution_ctx.user_id,
                        project_id=execution_ctx.project_id,
                        pattern=pattern,
                        case_sensitive=case_sensitive,
                        page=page,
                        page_size=page_size,
                    )
                    total = raw.get("total", 0)
                    grouped = build_search_payload(
                        execution_ctx.db,
                        search_type="regex",
                        results=raw.get("results", []),
                        language=execution_ctx.language,
                        pattern=pattern,
                        case_sensitive=case_sensitive,
                        page=page,
                        page_size=page_size,
                        total=total,
                    )
                    return ToolExecutionOutcome(
                        lifecycle="applied",
                        result=make_result(
                            f"Found {total} results for regex '{pattern}'",
                            data={"searchPayload": grouped},
                        ),
                    )

                queries = args.get("queries")
                if not isinstance(queries, list) or not all(isinstance(q, str) for q in queries):
                    raise ValueError("search_semantic requires queries: string[]")
                search_cfg = settings_service.get_search_settings(execution_ctx.db, execution_ctx.user_id)
                provider_config = credential_service.get_provider_config(
                    execution_ctx.db,
                    execution_ctx.user_id,
                    search_cfg.embedding.provider,
                )
                raw_results = await search_project(
                    execution_ctx.db,
                    user_id=execution_ctx.user_id,
                    project_id=execution_ctx.project_id,
                    queries=queries,
                    provider_config=provider_config,
                    top_k_per_query=search_cfg.retrieval.top_k_per_query,
                    neighbor_window=search_cfg.retrieval.neighbor_window,
                    max_primary_items=search_cfg.retrieval.max_primary_items,
                    max_total_items=search_cfg.retrieval.max_total_items,
                )
                grouped = build_search_payload(
                    execution_ctx.db,
                    search_type="semantic",
                    results=raw_results,
                    language=execution_ctx.language,
                    queries=queries,
                    total=len(raw_results),
                )
                return ToolExecutionOutcome(
                    lifecycle="applied",
                    result=make_result(f"Found {len(raw_results)} results", data={"searchPayload": grouped}),
                )

            bindings.append(
                ToolBinding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="search",
                        category="read",
                        op="search",
                        target_kind="project_tree",
                    ),
                    validate=_validate,
                    execute=_execute,
                    build_persisted_meta=lambda _ctx, _args: _persisted_meta(),
                )
            )
        return filter_allowed_bindings(ctx, bindings)

from __future__ import annotations

from typing import Any

from ..contracts import PersistedToolMeta, ToolBinding, ToolBindingMeta, ToolDecisionGroup, ToolExecutionResult, ToolFeatureModule, ToolSpec
from ..registry import tool_feature_module
from ..result_utils import invalid_result, make_result, valid_result
from .feature_common import apply_object_batch_group, filter_allowed_bindings, merge_key_for
from .object_access import extract_lang_data, get_primary_object_id, patch_object_field, read_object, read_runtime_object
from .shared import filter_allowed_specs, is_agent_write_context, is_object_journey, is_translation_journey, obj_schema


def _project_data_specs(ctx) -> list[ToolSpec]:
    specs: list[ToolSpec] = []

    if is_agent_write_context(ctx) or is_object_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="replace_basic_info",
                    description="Replace project basic info.",
                    parameters=obj_schema(
                        {
                            "title": {"type": "string"},
                            "logline": {"type": "string"},
                            "genres": {"type": "array", "items": {"type": "string"}},
                            "tags": {"type": "array", "items": {"type": "string"}},
                        },
                        [],
                    ),
                    auto_approve_category="replace",
                ),
                ToolSpec(
                    name="patch_basic_info",
                    description="Patch basic info by single replacement.",
                    parameters=obj_schema(
                        {
                            "field": {"type": "string", "enum": ["title", "logline"]},
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                        ["field", "old", "new"],
                    ),
                    auto_approve_category="patch",
                ),
                ToolSpec(
                    name="replace_guidelines",
                    description="Replace guidelines.",
                    parameters=obj_schema({"authorNote": {"type": "string"}}, ["authorNote"]),
                    auto_approve_category="replace",
                ),
                ToolSpec(
                    name="patch_guidelines",
                    description="Patch guidelines by single replacement.",
                    parameters=obj_schema(
                        {
                            "field": {"type": "string", "enum": ["authorNote"]},
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                        ["field", "old", "new"],
                    ),
                    auto_approve_category="patch",
                ),
            ]
        )

    if is_translation_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="translate_basic_info",
                    description="Translate project basic info.",
                    parameters=obj_schema(
                        {
                            "title": {"type": "string"},
                            "logline": {"type": "string"},
                            "genres": {"type": "array", "items": {"type": "string"}},
                            "tags": {"type": "array", "items": {"type": "string"}},
                        },
                        ["title", "logline", "genres", "tags"],
                    ),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="patch_translation_basic_info",
                    description="Patch basic info translation by single replacement.",
                    parameters=obj_schema(
                        {
                            "field": {"type": "string", "enum": ["title", "logline"]},
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                        ["field", "old", "new"],
                    ),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="translate_guidelines",
                    description="Translate guidelines.",
                    parameters=obj_schema({"authorNote": {"type": "string"}}, ["authorNote"]),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="patch_translation_guidelines",
                    description="Patch guidelines translation by single replacement.",
                    parameters=obj_schema(
                        {
                            "field": {"type": "string", "enum": ["authorNote"]},
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                        ["field", "old", "new"],
                    ),
                    auto_approve_category="patch_translation",
                ),
            ]
        )

    return filter_allowed_specs(ctx, specs)


def _safe_primary_object_id(ctx, object_type: str) -> str | None:
    try:
        return str(get_primary_object_id(ctx.db, ctx.project_id, object_type))
    except Exception:  # noqa: BLE001
        return None


def _persisted_meta(*, target_kind: str, category: str, op: str):
    def _builder(ctx, _args: dict[str, Any]) -> PersistedToolMeta:
        target_id = _safe_primary_object_id(ctx, target_kind)
        language = str(getattr(ctx.run, "language", "") or "English")
        return PersistedToolMeta(
            feature_key="project_data",
            category=category,
            op=op,
            target_kind=target_kind,
            target_id=target_id,
            merge_key=merge_key_for(category, target_kind=target_kind, target_id=target_id, language=language),
        )

    return _builder


def _replace_fields(item) -> dict[str, Any]:
    args = item.args
    if item.meta.target_kind == "basic_info":
        return {key: args[key] for key in ("title", "logline", "genres", "tags") if key in args}
    return {key: args[key] for key in ("authorNote",) if key in args}


async def _grouped_execute(_args, _ctx):
    raise RuntimeError("Grouped project_data tools must execute via apply_group")


@tool_feature_module()
class ProjectDataFeatureModule(ToolFeatureModule):
    feature_key = "project_data"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        specs = {spec.name: spec for spec in _project_data_specs(ctx)}
        bindings: list[ToolBinding] = []
        definitions = [
            ("replace_basic_info", "basic_info", "write", "replace", self._validate_replace_basic_info),
            ("patch_basic_info", "basic_info", "write", "patch", self._validate_patch_basic_info),
            ("translate_basic_info", "basic_info", "translate", "translate", self._validate_translate_basic_info),
            ("patch_translation_basic_info", "basic_info", "translate", "patch_translation", self._validate_patch_translation_basic_info),
            ("replace_guidelines", "guidelines", "write", "replace", self._validate_replace_guidelines),
            ("patch_guidelines", "guidelines", "write", "patch", self._validate_patch_guidelines),
            ("translate_guidelines", "guidelines", "translate", "translate", self._validate_translate_guidelines),
            ("patch_translation_guidelines", "guidelines", "translate", "patch_translation", self._validate_patch_translation_guidelines),
        ]
        for name, target_kind, category, op, validate_fn in definitions:
            spec = specs.get(name)
            if spec is None:
                continue
            bindings.append(
                ToolBinding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="project_data",
                        category=category,
                        op=op,
                        target_kind=target_kind,
                    ),
                    validate=validate_fn,
                    execute=_grouped_execute,
                    build_persisted_meta=_persisted_meta(target_kind=target_kind, category=category, op=op),
                )
            )
        return filter_allowed_bindings(ctx, bindings)

    async def apply_group(self, *, group: ToolDecisionGroup, ctx) -> list[ToolExecutionResult]:
        return await apply_object_batch_group(
            group=group,
            ctx=ctx,
            object_type_for_item=lambda item: "basic_info" if item.meta.target_kind == "basic_info" else "guidelines",
            replace_fields_for_item=_replace_fields,
            metadata_for_item=lambda _item: None,
            result_for_item=lambda item: make_result(
                f"Applied {item.binding.spec.name}",
                object_id=item.meta.target_id,
                object_type=item.meta.target_kind,
            ),
        )

    async def _validate_replace_basic_info(self, _args, ctx):
        try:
            get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_replace_basic_info", str(exc))

    async def _validate_patch_basic_info(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"title", "logline"}:
                raise ValueError("field must be one of title|logline")
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
            current = read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="basic_info",
                object_id=object_id,
                language=ctx.language,
            )
            patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(field),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_basic_info", str(exc))

    async def _validate_translate_basic_info(self, _args, ctx):
        try:
            get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_translate_basic_info", str(exc))

    async def _validate_patch_translation_basic_info(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"title", "logline"}:
                raise ValueError("field must be one of title|logline")
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
            current = read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="basic_info",
                object_id=object_id,
                language=ctx.language,
            )
            patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(field),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_translation_basic_info", str(exc))

    async def _validate_replace_guidelines(self, _args, ctx):
        try:
            get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_replace_guidelines", str(exc))

    async def _validate_patch_guidelines(self, args, ctx):
        try:
            if args.get("field") != "authorNote":
                raise ValueError("field must be authorNote")
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
            current = read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="guidelines",
                object_id=object_id,
                language=ctx.language,
            )
            patch_object_field(
                extract_lang_data(current, ctx.language),
                field="authorNote",
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_guidelines", str(exc))

    async def _validate_translate_guidelines(self, _args, ctx):
        try:
            get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_translate_guidelines", str(exc))

    async def _validate_patch_translation_guidelines(self, args, ctx):
        try:
            if args.get("field") != "authorNote":
                raise ValueError("field must be authorNote")
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
            current = read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="guidelines",
                object_id=object_id,
                language=ctx.language,
            )
            patch_object_field(
                extract_lang_data(current, ctx.language),
                field="authorNote",
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_translation_guidelines", str(exc))

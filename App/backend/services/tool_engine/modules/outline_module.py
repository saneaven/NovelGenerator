from __future__ import annotations

from typing import Any

from ..contracts import PersistedToolMeta, ToolBindingMeta, ToolDecisionGroup, ToolExecutionResult, ToolFeatureModule
from ..registry import tool_feature_module
from ..result_utils import make_result
from .create_module import CreateToolCallModule
from .delete_module import DeleteToolCallModule
from .feature_common import (
    apply_object_batch_group,
    build_legacy_binding,
    filter_allowed_bindings,
    legacy_specs_by_name,
    merge_key_for,
)
from .patch_module import PatchToolCallModule
from .patch_translation_module import PatchTranslationToolCallModule
from .read_module import ReadToolCallModule
from .replace_module import ReplaceToolCallModule
from .shared import is_agent_write_context, is_non_journey, is_outline_journey, is_translation_journey
from .translate_module import TranslateToolCallModule


_READ = ReadToolCallModule()
_CREATE = CreateToolCallModule()
_REPLACE = ReplaceToolCallModule()
_PATCH = PatchToolCallModule()
_DELETE = DeleteToolCallModule()
_TRANSLATE = TranslateToolCallModule()
_PATCH_TRANSLATION = PatchTranslationToolCallModule()


def _safe_target_id(args: dict[str, Any]) -> str | None:
    value = args.get("id")
    return str(value) if value is not None else None


def _persisted_meta(*, category: str, op: str, grouped: bool):
    def _builder(ctx, args: dict[str, Any]) -> PersistedToolMeta:
        target_id = _safe_target_id(args)
        language = str(getattr(ctx.run, "language", "") or "English")
        return PersistedToolMeta(
            feature_key="outline",
            category=category,
            op=op,
            target_kind="outline",
            target_id=target_id,
            merge_key=merge_key_for(category, target_kind="outline", target_id=target_id, language=language) if grouped else None,
        )

    return _builder


def _metadata(item) -> dict[str, Any] | None:
    args = item.args
    meta: dict[str, Any] = {}
    if isinstance(args.get("position"), int):
        meta["position"] = int(args["position"])
    if "parentId" in args:
        meta["parent_id"] = args.get("parentId")
    return meta or None


def _replace_fields(item) -> dict[str, Any]:
    return {key: item.args[key] for key in ("name", "description", "content") if key in item.args}


@tool_feature_module()
class OutlineFeatureModule(ToolFeatureModule):
    feature_key = "outline"

    def list_bindings(self, ctx) -> list:
        if not (is_non_journey(ctx) or is_agent_write_context(ctx) or is_outline_journey(ctx) or is_translation_journey(ctx)):
            return []

        read_specs = legacy_specs_by_name(_READ, ctx)
        create_specs = legacy_specs_by_name(_CREATE, ctx)
        replace_specs = legacy_specs_by_name(_REPLACE, ctx)
        patch_specs = legacy_specs_by_name(_PATCH, ctx)
        delete_specs = legacy_specs_by_name(_DELETE, ctx)
        translate_specs = legacy_specs_by_name(_TRANSLATE, ctx)
        patch_translation_specs = legacy_specs_by_name(_PATCH_TRANSLATION, ctx)

        definitions = [
            ("read_outline", "read", "read", False, read_specs, _READ),
            ("create_outline", "write", "create", False, create_specs, _CREATE),
            ("replace_outline", "write", "replace", True, replace_specs, _REPLACE),
            ("patch_outline", "write", "patch", True, patch_specs, _PATCH),
            ("delete_outline", "delete", "delete", False, delete_specs, _DELETE),
            ("translate_outline", "translate", "translate", True, translate_specs, _TRANSLATE),
            ("patch_translation_outline", "translate", "patch_translation", True, patch_translation_specs, _PATCH_TRANSLATION),
        ]

        bindings = []
        for name, category, op, grouped, source, module in definitions:
            spec = source.get(name)
            if spec is None:
                continue
            bindings.append(
                build_legacy_binding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="outline",
                        category=category,
                        op=op,
                        target_kind="outline",
                    ),
                    module=module,
                    tool_name=name,
                    build_persisted_meta=_persisted_meta(category=category, op=op, grouped=grouped),
                )
            )
        return filter_allowed_bindings(ctx, bindings)

    async def apply_group(self, *, group: ToolDecisionGroup, ctx) -> list[ToolExecutionResult]:
        return await apply_object_batch_group(
            group=group,
            ctx=ctx,
            object_type_for_item=lambda _item: "outline",
            replace_fields_for_item=_replace_fields,
            metadata_for_item=_metadata,
            result_for_item=lambda item: make_result(
                f"Applied {item.binding.spec.name}",
                object_id=item.meta.target_id,
                object_type="outline",
            ),
        )

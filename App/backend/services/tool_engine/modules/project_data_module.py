from __future__ import annotations

from typing import Any

from ..contracts import PersistedToolMeta, ToolBindingMeta, ToolFeatureModule, ToolDecisionGroup, ToolExecutionResult
from ..registry import tool_feature_module
from ..result_utils import make_result
from .feature_common import (
    apply_object_batch_group,
    build_legacy_binding,
    filter_allowed_bindings,
    legacy_specs_by_name,
    merge_key_for,
)
from .object_access import get_primary_object_id
from .patch_module import PatchToolCallModule
from .patch_translation_module import PatchTranslationToolCallModule
from .replace_module import ReplaceToolCallModule
from .shared import is_agent_write_context, is_object_journey, is_translation_journey
from .translate_module import TranslateToolCallModule


_REPLACE = ReplaceToolCallModule()
_PATCH = PatchToolCallModule()
_TRANSLATE = TranslateToolCallModule()
_PATCH_TRANSLATION = PatchTranslationToolCallModule()


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


@tool_feature_module()
class ProjectDataFeatureModule(ToolFeatureModule):
    feature_key = "project_data"

    def list_bindings(self, ctx) -> list:
        if not (is_agent_write_context(ctx) or is_object_journey(ctx) or is_translation_journey(ctx)):
            return []

        replace_specs = legacy_specs_by_name(_REPLACE, ctx)
        patch_specs = legacy_specs_by_name(_PATCH, ctx)
        translate_specs = legacy_specs_by_name(_TRANSLATE, ctx)
        patch_translation_specs = legacy_specs_by_name(_PATCH_TRANSLATION, ctx)

        bindings = []
        for name, target_kind, category, op, source in (
            ("replace_basic_info", "basic_info", "write", "replace", replace_specs),
            ("patch_basic_info", "basic_info", "write", "patch", patch_specs),
            ("translate_basic_info", "basic_info", "translate", "translate", translate_specs),
            ("patch_translation_basic_info", "basic_info", "translate", "patch_translation", patch_translation_specs),
            ("replace_guidelines", "guidelines", "write", "replace", replace_specs),
            ("patch_guidelines", "guidelines", "write", "patch", patch_specs),
            ("translate_guidelines", "guidelines", "translate", "translate", translate_specs),
            ("patch_translation_guidelines", "guidelines", "translate", "patch_translation", patch_translation_specs),
        ):
            spec = source.get(name)
            if spec is None:
                continue
            module = {
                "replace": _REPLACE,
                "patch": _PATCH,
                "translate": _TRANSLATE,
                "patch_translation": _PATCH_TRANSLATION,
            }[op]
            bindings.append(
                build_legacy_binding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="project_data",
                        category=category,
                        op=op,
                        target_kind=target_kind,
                    ),
                    module=module,
                    tool_name=name,
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

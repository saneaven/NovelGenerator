from __future__ import annotations

from typing import Any

from ..contracts import PersistedToolMeta, ToolBindingMeta, ToolDecisionGroup, ToolExecutionResult, ToolFeatureModule
from ..registry import tool_feature_module
from ..result_utils import make_result
from .feature_common import (
    apply_manuscript_batch_group,
    build_legacy_binding,
    filter_allowed_bindings,
    legacy_specs_by_name,
    merge_key_for,
)
from .patch_module import PatchToolCallModule
from .patch_translation_module import PatchTranslationToolCallModule
from .read_module import ReadToolCallModule
from .replace_module import ReplaceToolCallModule
from .shared import is_agent_write_context, is_manuscript_journey, is_non_journey, is_translation_journey
from .translate_module import TranslateToolCallModule


_READ = ReadToolCallModule()
_REPLACE = ReplaceToolCallModule()
_PATCH = PatchToolCallModule()
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
            feature_key="manuscript",
            category=category,
            op=op,
            target_kind="manuscript",
            target_id=target_id,
            merge_key=merge_key_for(category, target_kind="manuscript", target_id=target_id, language=language) if grouped else None,
        )

    return _builder


@tool_feature_module()
class ManuscriptFeatureModule(ToolFeatureModule):
    feature_key = "manuscript"

    def list_bindings(self, ctx) -> list:
        if not (is_non_journey(ctx) or is_agent_write_context(ctx) or is_manuscript_journey(ctx) or is_translation_journey(ctx)):
            return []

        read_specs = legacy_specs_by_name(_READ, ctx)
        replace_specs = legacy_specs_by_name(_REPLACE, ctx)
        patch_specs = legacy_specs_by_name(_PATCH, ctx)
        translate_specs = legacy_specs_by_name(_TRANSLATE, ctx)
        patch_translation_specs = legacy_specs_by_name(_PATCH_TRANSLATION, ctx)

        definitions = [
            ("read_manuscript", "read", "read", False, read_specs, _READ),
            ("replace_manuscript", "write", "replace", True, replace_specs, _REPLACE),
            ("patch_manuscript", "write", "patch", True, patch_specs, _PATCH),
            ("translate_manuscript", "translate", "translate", True, translate_specs, _TRANSLATE),
            ("patch_translation_manuscript", "translate", "patch_translation", True, patch_translation_specs, _PATCH_TRANSLATION),
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
                        feature_key="manuscript",
                        category=category,
                        op=op,
                        target_kind="manuscript",
                    ),
                    module=module,
                    tool_name=name,
                    build_persisted_meta=_persisted_meta(category=category, op=op, grouped=grouped),
                )
            )
        return filter_allowed_bindings(ctx, bindings)

    async def apply_group(self, *, group: ToolDecisionGroup, ctx) -> list[ToolExecutionResult]:
        return await apply_manuscript_batch_group(
            group=group,
            ctx=ctx,
            result_for_item=lambda item: make_result(
                f"Applied {item.binding.spec.name}",
                object_id=item.meta.target_id,
                object_type="manuscript",
            ),
        )

from __future__ import annotations

from typing import Any

from ..contracts import (
    PersistedToolMeta,
    ToolBinding,
    ToolBindingMeta,
    ToolDecisionGroup,
    ToolExecutionOutcome,
    ToolExecutionResult,
    ToolFeatureModule,
    ToolSpec,
)
from ..registry import tool_feature_module
from ..result_utils import invalid_result, make_result, valid_result
from .feature_common import apply_manuscript_batch_group, filter_allowed_bindings, merge_key_for
from .manuscript_access import ensure_manuscript_exists, read_manuscript_markdown, validate_patch_args
from .manuscript_paragraphs import parse_markdown_paragraph_offset, slice_markdown_by_paragraph_offset
from .object_access import to_uuid
from .shared import filter_allowed_specs, is_agent_write_context, is_manuscript_journey, is_non_journey, is_translation_journey, obj_schema


_ID = {"type": "string", "description": "Object ID"}


def _manuscript_specs(ctx) -> list[ToolSpec]:
    specs: list[ToolSpec] = []

    if is_non_journey(ctx):
        specs.append(
            ToolSpec(
                name="read_manuscript",
                description="Read manuscript text. Optional offset selects Markdown paragraphs by 0-based index: from inclusive, to exclusive.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "offset": {
                            "type": "object",
                            "description": "Optional Markdown paragraph range. from is inclusive, to is exclusive.",
                            "additionalProperties": False,
                            "properties": {
                                "from": {"type": "integer", "description": "0-based Markdown paragraph start index, inclusive."},
                                "to": {"type": "integer", "description": "0-based Markdown paragraph end index, exclusive."},
                            },
                            "required": ["from", "to"],
                        },
                    },
                    ["id"],
                ),
                auto_approve_category="read",
            )
        )

    if is_agent_write_context(ctx) or is_manuscript_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="replace_manuscript",
                    description="Replace full manuscript content.",
                    parameters=obj_schema({"id": _ID, "content": {"type": "string"}}, ["id", "content"]),
                    auto_approve_category="replace",
                ),
                ToolSpec(
                    name="patch_manuscript",
                    description="Patch manuscript by single replacement.",
                    parameters=obj_schema({"id": _ID, "old": {"type": "string"}, "new": {"type": "string"}}, ["id", "old", "new"]),
                    auto_approve_category="patch",
                ),
            ]
        )

    if is_translation_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="translate_manuscript",
                    description="Translate full manuscript content.",
                    parameters=obj_schema({"id": _ID, "content": {"type": "string"}}, ["id", "content"]),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="patch_translation_manuscript",
                    description="Patch manuscript translation by single replacement.",
                    parameters=obj_schema({"id": _ID, "old": {"type": "string"}, "new": {"type": "string"}}, ["id", "old", "new"]),
                    auto_approve_category="patch_translation",
                ),
            ]
        )

    return filter_allowed_specs(ctx, specs)


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


async def _grouped_execute(_args, _ctx):
    raise RuntimeError("Grouped manuscript tools must execute via apply_group")


@tool_feature_module()
class ManuscriptFeatureModule(ToolFeatureModule):
    feature_key = "manuscript"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        specs = {spec.name: spec for spec in _manuscript_specs(ctx)}
        bindings: list[ToolBinding] = []

        immediate_defs = [
            (
                "read_manuscript",
                ToolBindingMeta(feature_key="manuscript", category="read", op="read", target_kind="manuscript"),
                self._validate_read_manuscript,
                self._execute_read_manuscript,
                _persisted_meta(category="read", op="read", grouped=False),
            ),
        ]
        grouped_defs = [
            (
                "replace_manuscript",
                ToolBindingMeta(feature_key="manuscript", category="write", op="replace", target_kind="manuscript"),
                self._validate_replace_manuscript,
                _persisted_meta(category="write", op="replace", grouped=True),
            ),
            (
                "patch_manuscript",
                ToolBindingMeta(feature_key="manuscript", category="write", op="patch", target_kind="manuscript"),
                self._validate_patch_manuscript,
                _persisted_meta(category="write", op="patch", grouped=True),
            ),
            (
                "translate_manuscript",
                ToolBindingMeta(feature_key="manuscript", category="translate", op="translate", target_kind="manuscript"),
                self._validate_translate_manuscript,
                _persisted_meta(category="translate", op="translate", grouped=True),
            ),
            (
                "patch_translation_manuscript",
                ToolBindingMeta(feature_key="manuscript", category="translate", op="patch_translation", target_kind="manuscript"),
                self._validate_patch_translation_manuscript,
                _persisted_meta(category="translate", op="patch_translation", grouped=True),
            ),
        ]

        for name, meta, validate_fn, execute_fn, persisted_meta_builder in immediate_defs:
            spec = specs.get(name)
            if spec is None:
                continue
            bindings.append(
                ToolBinding(
                    spec=spec,
                    meta=meta,
                    validate=validate_fn,
                    execute=execute_fn,
                    build_persisted_meta=persisted_meta_builder,
                )
            )

        for name, meta, validate_fn, persisted_meta_builder in grouped_defs:
            spec = specs.get(name)
            if spec is None:
                continue
            bindings.append(
                ToolBinding(
                    spec=spec,
                    meta=meta,
                    validate=validate_fn,
                    execute=_grouped_execute,
                    build_persisted_meta=persisted_meta_builder,
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

    async def _validate_read_manuscript(self, args, ctx):
        try:
            parse_markdown_paragraph_offset(args.get("offset"))
            ensure_manuscript_exists(
                db=ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_read_manuscript", str(exc))

    async def _execute_read_manuscript(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        _, content = await read_manuscript_markdown(
            db=ctx.db,
            project_id=ctx.project_id,
            object_id=object_id,
            language=ctx.language,
        )
        content = slice_markdown_by_paragraph_offset(content, args.get("offset"))
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                "Read successful",
                object_id=str(object_id),
                object_type="manuscript",
                data={"object": {"content": content}},
            ),
        )

    async def _validate_replace_manuscript(self, args, ctx):
        try:
            ensure_manuscript_exists(
                db=ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_replace_manuscript", str(exc))

    async def _validate_patch_manuscript(self, args, ctx):
        try:
            object_id = to_uuid(args.get("id"), "id")
            ensure_manuscript_exists(db=ctx.db, project_id=ctx.project_id, object_id=object_id, language=ctx.language)
            await validate_patch_args(args=args, ctx=ctx, object_id=object_id)
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_manuscript", str(exc))

    async def _validate_translate_manuscript(self, args, ctx):
        try:
            ensure_manuscript_exists(
                db=ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_translate_manuscript", str(exc))

    async def _validate_patch_translation_manuscript(self, args, ctx):
        try:
            object_id = to_uuid(args.get("id"), "id")
            ensure_manuscript_exists(db=ctx.db, project_id=ctx.project_id, object_id=object_id, language=ctx.language)
            await validate_patch_args(args=args, ctx=ctx, object_id=object_id)
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_translation_manuscript", str(exc))

from __future__ import annotations

from typing import Any

from ....services.object_service import object_service
from ....services.outline_service import require_outline_kind
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
from .feature_common import apply_object_batch_group, filter_allowed_bindings, merge_key_for
from .object_access import (
    ensure_outline_parent_kind,
    extract_lang_data,
    patch_object_field,
    read_runtime_object,
    runtime_rich_text_kwargs,
    to_uuid,
)
from .shared import filter_allowed_specs, is_agent_write_context, is_non_journey, is_outline_journey, is_translation_journey, obj_schema


_ID = {"type": "string", "description": "Object ID"}
_NAME = {"type": "string", "description": "Name"}
_DESC = {"type": "string", "description": "Description"}
_CONTENT = {"type": "string", "description": "Content"}
_OUTLINE_KIND = {"type": "string", "enum": ["outline", "act", "chapter"]}
_PARENT_ID = {"type": ["string", "null"], "description": "Parent outline ID. Root outlines must use null."}
_POSITION = {"type": "integer", "description": "0-based sibling position."}


def _outline_specs(ctx) -> list[ToolSpec]:
    specs: list[ToolSpec] = []

    if is_non_journey(ctx):
        specs.append(
            ToolSpec(
                name="read_outline",
                description="Read an outline item.",
                parameters=obj_schema({"id": _ID}, ["id"]),
                auto_approve_category="read",
            )
        )

    if is_agent_write_context(ctx) or is_outline_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="create_outline",
                    description="Create an outline, act, or chapter.",
                    parameters=obj_schema(
                        {
                            "kind": _OUTLINE_KIND,
                            "parentId": _PARENT_ID,
                            "position": _POSITION,
                            "name": _NAME,
                            "description": _DESC,
                            "content": _CONTENT,
                        },
                        ["kind", "name", "description", "content"],
                    ),
                    auto_approve_category="create",
                ),
                ToolSpec(
                    name="replace_outline",
                    description="Replace outline item fields.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "parentId": _PARENT_ID,
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "content": {"type": "string"},
                            "position": _POSITION,
                        },
                        ["id"],
                    ),
                    auto_approve_category="replace",
                ),
                ToolSpec(
                    name="patch_outline",
                    description="Patch outline item by single replacement.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "field": {"type": "string", "enum": ["name", "description", "content"]},
                            "parentId": _PARENT_ID,
                            "position": _POSITION,
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                        ["id", "field", "old", "new"],
                    ),
                    auto_approve_category="patch",
                ),
                ToolSpec(
                    name="delete_outline",
                    description="Delete an outline item.",
                    parameters=obj_schema({"id": _ID}, ["id"]),
                    auto_approve_category="delete",
                ),
            ]
        )

    if is_translation_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="translate_outline",
                    description="Translate outline item fields.",
                    parameters=obj_schema(
                        {"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}},
                        ["id", "name", "description", "content"],
                    ),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="patch_translation_outline",
                    description="Patch outline item translation by single replacement.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "field": {"type": "string", "enum": ["name", "description", "content"]},
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                        ["id", "field", "old", "new"],
                    ),
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


def _non_negative_position(value: Any) -> None:
    if value is None:
        return
    if isinstance(value, int) and value >= 0:
        return
    raise ValueError("position must be a non-negative integer")


async def _grouped_execute(_args, _ctx):
    raise RuntimeError("Grouped outline tools must execute via apply_group")


@tool_feature_module()
class OutlineFeatureModule(ToolFeatureModule):
    feature_key = "outline"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        specs = {spec.name: spec for spec in _outline_specs(ctx)}
        bindings: list[ToolBinding] = []

        immediate_defs = [
            (
                "read_outline",
                ToolBindingMeta(feature_key="outline", category="read", op="read", target_kind="outline"),
                self._validate_read_outline,
                self._execute_read_outline,
                _persisted_meta(category="read", op="read", grouped=False),
            ),
            (
                "create_outline",
                ToolBindingMeta(feature_key="outline", category="write", op="create", target_kind="outline"),
                self._validate_create_outline,
                self._execute_create_outline,
                _persisted_meta(category="write", op="create", grouped=False),
            ),
            (
                "delete_outline",
                ToolBindingMeta(feature_key="outline", category="delete", op="delete", target_kind="outline"),
                self._validate_delete_outline,
                self._execute_delete_outline,
                _persisted_meta(category="delete", op="delete", grouped=False),
            ),
        ]
        grouped_defs = [
            (
                "replace_outline",
                ToolBindingMeta(feature_key="outline", category="write", op="replace", target_kind="outline"),
                self._validate_replace_outline,
                _persisted_meta(category="write", op="replace", grouped=True),
            ),
            (
                "patch_outline",
                ToolBindingMeta(feature_key="outline", category="write", op="patch", target_kind="outline"),
                self._validate_patch_outline,
                _persisted_meta(category="write", op="patch", grouped=True),
            ),
            (
                "translate_outline",
                ToolBindingMeta(feature_key="outline", category="translate", op="translate", target_kind="outline"),
                self._validate_translate_outline,
                _persisted_meta(category="translate", op="translate", grouped=True),
            ),
            (
                "patch_translation_outline",
                ToolBindingMeta(feature_key="outline", category="translate", op="patch_translation", target_kind="outline"),
                self._validate_patch_translation_outline,
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

    async def _validate_read_outline(self, args, ctx):
        try:
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="outline",
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_read_outline", str(exc))

    async def _execute_read_outline(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        obj = read_runtime_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type="outline",
            object_id=object_id,
            language=ctx.language,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                "Read successful",
                object_id=str(object_id),
                object_type="outline",
                data={"object": {"kind": obj.get("kind"), **extract_lang_data(obj, ctx.language)}},
            ),
        )

    async def _validate_create_outline(self, args, ctx):
        try:
            outline_kind = require_outline_kind(args.get("kind"))
            parent_id = args.get("parentId")
            if outline_kind == "outline":
                if parent_id not in {None, ""}:
                    raise ValueError("Root outlines cannot have parentId")
            elif outline_kind == "act":
                ensure_outline_parent_kind(
                    ctx.db,
                    project_id=ctx.project_id,
                    outline_id=to_uuid(parent_id, "parentId"),
                    expected_kind="outline",
                )
            elif outline_kind == "chapter":
                ensure_outline_parent_kind(
                    ctx.db,
                    project_id=ctx.project_id,
                    outline_id=to_uuid(parent_id, "parentId"),
                    expected_kind="act",
                )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_create_outline", str(exc))

    async def _execute_create_outline(self, args, ctx):
        outline_kind = require_outline_kind(args.get("kind"))
        created = object_service.create_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type="outline",
            data={
                "name": str(args.get("name") or ""),
                "description": str(args.get("description") or ""),
                "content": str(args.get("content") or ""),
            },
            language=ctx.language,
            **runtime_rich_text_kwargs("outline"),
            kind=outline_kind,
            metadata={
                "parent_id": args.get("parentId"),
                "position": args.get("position"),
            },
            user_request="tool:create_outline",
            created_by=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                f"Created {outline_kind}",
                object_id=created["id"],
                object_type="outline",
                data={"kind": outline_kind, "manuscriptId": created.get("metadata", {}).get("manuscript_id")},
            ),
        )

    async def _validate_delete_outline(self, args, ctx):
        try:
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="outline",
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_delete_outline", str(exc))

    async def _execute_delete_outline(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        object_service.delete_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type="outline",
            object_id=object_id,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Deleted outline", object_id=str(object_id), object_type="outline"),
        )

    async def _validate_replace_outline(self, args, ctx):
        try:
            object_id = to_uuid(args.get("id"), "id")
            _non_negative_position(args.get("position"))
            if args.get("parentId"):
                current = read_runtime_object(
                    ctx.db,
                    project_id=ctx.project_id,
                    object_type="outline",
                    object_id=object_id,
                    language=ctx.language,
                )
                current_kind = str(current.get("kind") or "")
                if current_kind == "act":
                    ensure_outline_parent_kind(
                        ctx.db,
                        project_id=ctx.project_id,
                        outline_id=to_uuid(args.get("parentId"), "parentId"),
                        expected_kind="outline",
                    )
                elif current_kind == "chapter":
                    ensure_outline_parent_kind(
                        ctx.db,
                        project_id=ctx.project_id,
                        outline_id=to_uuid(args.get("parentId"), "parentId"),
                        expected_kind="act",
                    )
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="outline",
                object_id=object_id,
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_replace_outline", str(exc))

    async def _validate_patch_outline(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description", "content"}:
                raise ValueError("field must be one of name|description|content")
            object_id = to_uuid(args.get("id"), "id")
            _non_negative_position(args.get("position"))
            if args.get("parentId"):
                current = read_runtime_object(
                    ctx.db,
                    project_id=ctx.project_id,
                    object_type="outline",
                    object_id=object_id,
                    language=ctx.language,
                )
                current_kind = str(current.get("kind") or "")
                if current_kind == "act":
                    ensure_outline_parent_kind(
                        ctx.db,
                        project_id=ctx.project_id,
                        outline_id=to_uuid(args.get("parentId"), "parentId"),
                        expected_kind="outline",
                    )
                elif current_kind == "chapter":
                    ensure_outline_parent_kind(
                        ctx.db,
                        project_id=ctx.project_id,
                        outline_id=to_uuid(args.get("parentId"), "parentId"),
                        expected_kind="act",
                    )
            current = read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="outline",
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
            return invalid_result("validate_patch_outline", str(exc))

    async def _validate_translate_outline(self, args, ctx):
        try:
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="outline",
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_translate_outline", str(exc))

    async def _validate_patch_translation_outline(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description", "content"}:
                raise ValueError("field must be one of name|description|content")
            current = read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="outline",
                object_id=to_uuid(args.get("id"), "id"),
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
            return invalid_result("validate_patch_translation_outline", str(exc))

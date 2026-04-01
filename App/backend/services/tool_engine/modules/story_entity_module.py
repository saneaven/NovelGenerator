from __future__ import annotations

from typing import Any

from ....services.object_service import object_service
from ....utils.story_entities import STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE
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
    STORY_ENTITY_KIND_VALUES,
    ensure_story_entity_folder_exists,
    extract_lang_data,
    patch_object_field,
    read_runtime_story_entity,
    read_story_entity_folder,
    require_story_entity_arg_kind,
    runtime_rich_text_kwargs,
    to_uuid,
)
from .shared import filter_allowed_specs, is_agent_write_context, is_non_journey, is_object_journey, is_translation_journey, obj_schema


_ID = {"type": "string", "description": "Object ID"}
_NAME = {"type": "string", "description": "Name"}
_DESC = {"type": "string", "description": "Description"}
_CONTENT = {"type": "string", "description": "Content"}
_ENTITY_KIND = {"type": "string", "enum": list(STORY_ENTITY_KIND_VALUES)}
_FOLDER_ID = {"type": ["string", "null"], "description": "Parent folder ID. Use null for root."}
_PARENT_ID = {"type": ["string", "null"], "description": "Parent folder ID. Use null for root."}
_POSITION = {"type": "integer", "description": "0-based sibling position."}


def _story_entity_specs(ctx) -> list[ToolSpec]:
    specs: list[ToolSpec] = []

    if is_non_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="read_story_entity",
                    description="Read a story entity.",
                    parameters=obj_schema({"id": _ID, "kind": _ENTITY_KIND}, ["id", "kind"]),
                    auto_approve_category="read",
                ),
                ToolSpec(
                    name="read_story_entity_folder",
                    description="Read a story entity folder.",
                    parameters=obj_schema({"id": _ID}, ["id"]),
                    auto_approve_category="read",
                ),
            ]
        )

    if is_agent_write_context(ctx) or is_object_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="create_story_entity",
                    description="Create a story entity.",
                    parameters=obj_schema(
                        {"kind": _ENTITY_KIND, "name": _NAME, "description": _DESC, "content": _CONTENT, "folderId": _FOLDER_ID},
                        ["kind", "name", "content"],
                    ),
                    auto_approve_category="create",
                ),
                ToolSpec(
                    name="create_story_entity_folder",
                    description="Create a story entity folder.",
                    parameters=obj_schema({"name": _NAME, "description": _DESC, "parentId": _PARENT_ID}, ["name"]),
                    auto_approve_category="create",
                ),
                ToolSpec(
                    name="replace_story_entity",
                    description="Replace story entity fields.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "kind": _ENTITY_KIND,
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "content": {"type": "string"},
                            "folderId": _FOLDER_ID,
                        },
                        ["id", "kind"],
                    ),
                    auto_approve_category="replace",
                ),
                ToolSpec(
                    name="replace_story_entity_folder",
                    description="Replace story entity folder fields.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "parentId": _PARENT_ID,
                            "position": _POSITION,
                        },
                        ["id"],
                    ),
                    auto_approve_category="replace",
                ),
                ToolSpec(
                    name="patch_story_entity",
                    description="Patch story entity by single replacement.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "kind": _ENTITY_KIND,
                            "field": {"type": "string", "enum": ["name", "description", "content"]},
                            "folderId": _FOLDER_ID,
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                        ["id", "kind", "field", "old", "new"],
                    ),
                    auto_approve_category="patch",
                ),
                ToolSpec(
                    name="patch_story_entity_folder",
                    description="Patch story entity folder by single replacement.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "field": {"type": "string", "enum": ["name", "description"]},
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
                    name="delete_story_entity",
                    description="Delete a story entity.",
                    parameters=obj_schema({"id": _ID, "kind": _ENTITY_KIND}, ["id", "kind"]),
                    auto_approve_category="delete",
                ),
                ToolSpec(
                    name="delete_story_entity_folder",
                    description="Delete a story entity folder.",
                    parameters=obj_schema({"id": _ID}, ["id"]),
                    auto_approve_category="delete",
                ),
            ]
        )

    if is_translation_journey(ctx):
        specs.extend(
            [
                ToolSpec(
                    name="translate_story_entity",
                    description="Translate story entity fields.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "kind": _ENTITY_KIND,
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "content": {"type": "string"},
                        },
                        ["id", "kind", "name", "description", "content"],
                    ),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="translate_story_entity_folder",
                    description="Translate story entity folder fields.",
                    parameters=obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}}, ["id"]),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="patch_translation_story_entity",
                    description="Patch story entity translation by single replacement.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "kind": _ENTITY_KIND,
                            "field": {"type": "string", "enum": ["name", "description", "content"]},
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                        ["id", "kind", "field", "old", "new"],
                    ),
                    auto_approve_category="patch_translation",
                ),
                ToolSpec(
                    name="patch_translation_story_entity_folder",
                    description="Patch story entity folder translation by single replacement.",
                    parameters=obj_schema(
                        {
                            "id": _ID,
                            "field": {"type": "string", "enum": ["name", "description"]},
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


def _persisted_meta(*, target_kind: str, category: str, op: str, grouped: bool):
    def _builder(ctx, args: dict[str, Any]) -> PersistedToolMeta:
        target_id = _safe_target_id(args)
        language = str(getattr(ctx.run, "language", "") or "English")
        return PersistedToolMeta(
            feature_key="story_entity",
            category=category,
            op=op,
            target_kind=target_kind,
            target_id=target_id,
            merge_key=(
                merge_key_for(category, target_kind=target_kind, target_id=target_id, language=language)
                if grouped
                else None
            ),
        )

    return _builder


def _object_type(item) -> str:
    return STORY_ENTITY_TYPE if item.meta.target_kind == "story_entity" else STORY_ENTITY_FOLDER_TYPE


def _metadata(item) -> dict[str, Any] | None:
    args = item.args
    if item.meta.target_kind == "story_entity":
        return {"folder_id": args.get("folderId")} if "folderId" in args else None
    meta: dict[str, Any] = {}
    if isinstance(args.get("position"), int):
        meta["display_order"] = int(args["position"])
    if "parentId" in args:
        meta["parent_id"] = args.get("parentId")
    return meta or None


def _replace_fields(item) -> dict[str, Any]:
    args = item.args
    if item.meta.target_kind == "story_entity":
        return {key: args[key] for key in ("name", "description", "content") if key in args}
    return {key: args[key] for key in ("name", "description") if key in args}


def _result_for_item(item):
    base = make_result(
        f"Applied {item.binding.spec.name}",
        object_id=item.meta.target_id,
        object_type=_object_type(item),
    )
    if item.meta.target_kind == "story_entity" and "kind" in item.args:
        base["data"] = {"kind": item.args.get("kind")}
    return base


def _non_negative_position(value: Any) -> None:
    if value is None:
        return
    if isinstance(value, int) and value >= 0:
        return
    raise ValueError("position must be a non-negative integer")


def _has_any_story_entity_folder_replace_field(args: dict[str, Any]) -> bool:
    return any(key in args for key in ("name", "description", "parentId", "position"))


async def _grouped_execute(_args, _ctx):
    raise RuntimeError("Grouped story_entity tools must execute via apply_group")


@tool_feature_module()
class StoryEntityFeatureModule(ToolFeatureModule):
    feature_key = "story_entity"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        specs = {spec.name: spec for spec in _story_entity_specs(ctx)}
        bindings: list[ToolBinding] = []

        immediate_defs = [
            (
                "read_story_entity",
                ToolBindingMeta(feature_key="story_entity", category="read", op="read", target_kind="story_entity"),
                self._validate_read_story_entity,
                self._execute_read_story_entity,
                _persisted_meta(target_kind="story_entity", category="read", op="read", grouped=False),
            ),
            (
                "create_story_entity",
                ToolBindingMeta(feature_key="story_entity", category="write", op="create", target_kind="story_entity"),
                self._validate_create_story_entity,
                self._execute_create_story_entity,
                _persisted_meta(target_kind="story_entity", category="write", op="create", grouped=False),
            ),
            (
                "delete_story_entity",
                ToolBindingMeta(feature_key="story_entity", category="delete", op="delete", target_kind="story_entity"),
                self._validate_delete_story_entity,
                self._execute_delete_story_entity,
                _persisted_meta(target_kind="story_entity", category="delete", op="delete", grouped=False),
            ),
            (
                "read_story_entity_folder",
                ToolBindingMeta(feature_key="story_entity", category="read", op="read", target_kind="story_entity_folder"),
                self._validate_read_story_entity_folder,
                self._execute_read_story_entity_folder,
                _persisted_meta(target_kind="story_entity_folder", category="read", op="read", grouped=False),
            ),
            (
                "create_story_entity_folder",
                ToolBindingMeta(feature_key="story_entity", category="write", op="create", target_kind="story_entity_folder"),
                self._validate_create_story_entity_folder,
                self._execute_create_story_entity_folder,
                _persisted_meta(target_kind="story_entity_folder", category="write", op="create", grouped=False),
            ),
            (
                "delete_story_entity_folder",
                ToolBindingMeta(feature_key="story_entity", category="delete", op="delete", target_kind="story_entity_folder"),
                self._validate_delete_story_entity_folder,
                self._execute_delete_story_entity_folder,
                _persisted_meta(target_kind="story_entity_folder", category="delete", op="delete", grouped=False),
            ),
        ]

        grouped_defs = [
            (
                "replace_story_entity",
                ToolBindingMeta(feature_key="story_entity", category="write", op="replace", target_kind="story_entity"),
                self._validate_replace_story_entity,
                _persisted_meta(target_kind="story_entity", category="write", op="replace", grouped=True),
            ),
            (
                "patch_story_entity",
                ToolBindingMeta(feature_key="story_entity", category="write", op="patch", target_kind="story_entity"),
                self._validate_patch_story_entity,
                _persisted_meta(target_kind="story_entity", category="write", op="patch", grouped=True),
            ),
            (
                "translate_story_entity",
                ToolBindingMeta(feature_key="story_entity", category="translate", op="translate", target_kind="story_entity"),
                self._validate_translate_story_entity,
                _persisted_meta(target_kind="story_entity", category="translate", op="translate", grouped=True),
            ),
            (
                "patch_translation_story_entity",
                ToolBindingMeta(feature_key="story_entity", category="translate", op="patch_translation", target_kind="story_entity"),
                self._validate_patch_translation_story_entity,
                _persisted_meta(target_kind="story_entity", category="translate", op="patch_translation", grouped=True),
            ),
            (
                "replace_story_entity_folder",
                ToolBindingMeta(feature_key="story_entity", category="write", op="replace", target_kind="story_entity_folder"),
                self._validate_replace_story_entity_folder,
                _persisted_meta(target_kind="story_entity_folder", category="write", op="replace", grouped=True),
            ),
            (
                "patch_story_entity_folder",
                ToolBindingMeta(feature_key="story_entity", category="write", op="patch", target_kind="story_entity_folder"),
                self._validate_patch_story_entity_folder,
                _persisted_meta(target_kind="story_entity_folder", category="write", op="patch", grouped=True),
            ),
            (
                "translate_story_entity_folder",
                ToolBindingMeta(feature_key="story_entity", category="translate", op="translate", target_kind="story_entity_folder"),
                self._validate_translate_story_entity_folder,
                _persisted_meta(target_kind="story_entity_folder", category="translate", op="translate", grouped=True),
            ),
            (
                "patch_translation_story_entity_folder",
                ToolBindingMeta(feature_key="story_entity", category="translate", op="patch_translation", target_kind="story_entity_folder"),
                self._validate_patch_translation_story_entity_folder,
                _persisted_meta(target_kind="story_entity_folder", category="translate", op="patch_translation", grouped=True),
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
            object_type_for_item=_object_type,
            replace_fields_for_item=_replace_fields,
            metadata_for_item=_metadata,
            result_for_item=_result_for_item,
        )

    async def _validate_read_story_entity(self, args, ctx):
        try:
            read_runtime_story_entity(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
                kind=args.get("kind"),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_read_story_entity", str(exc))

    async def _execute_read_story_entity(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        obj = read_runtime_story_entity(
            ctx.db,
            project_id=ctx.project_id,
            object_id=object_id,
            language=ctx.language,
            kind=args.get("kind"),
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                "Read successful",
                object_id=str(object_id),
                object_type=STORY_ENTITY_TYPE,
                data={"object": {"kind": obj.get("kind"), **extract_lang_data(obj, ctx.language)}},
            ),
        )

    async def _validate_create_story_entity(self, args, ctx):
        try:
            require_story_entity_arg_kind(args.get("kind"))
            ensure_story_entity_folder_exists(
                ctx.db,
                project_id=ctx.project_id,
                folder_id=args.get("folderId"),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_create_story_entity", str(exc))

    async def _execute_create_story_entity(self, args, ctx):
        kind = require_story_entity_arg_kind(args.get("kind"))
        created = object_service.create_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type=STORY_ENTITY_TYPE,
            data={
                "name": str(args.get("name") or ""),
                "description": str(args.get("description") or ""),
                "content": str(args.get("content") or ""),
            },
            language=ctx.language,
            **runtime_rich_text_kwargs(STORY_ENTITY_TYPE),
            metadata={"folder_id": args.get("folderId")},
            kind=kind,
            user_request="tool:create_story_entity",
            created_by=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                f"Created {kind}",
                object_id=created["id"],
                object_type=STORY_ENTITY_TYPE,
                data={"kind": kind},
            ),
        )

    async def _validate_delete_story_entity(self, args, ctx):
        try:
            read_runtime_story_entity(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
                kind=args.get("kind"),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_delete_story_entity", str(exc))

    async def _execute_delete_story_entity(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        object_service.delete_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type=STORY_ENTITY_TYPE,
            object_id=object_id,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                f"Deleted {args.get('kind')}",
                object_id=str(object_id),
                object_type=STORY_ENTITY_TYPE,
                data={"kind": args.get("kind")},
            ),
        )

    async def _validate_read_story_entity_folder(self, args, ctx):
        try:
            read_story_entity_folder(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_read_story_entity_folder", str(exc))

    async def _execute_read_story_entity_folder(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        obj = read_story_entity_folder(
            ctx.db,
            project_id=ctx.project_id,
            object_id=object_id,
            language=ctx.language,
        )
        lang_data = extract_lang_data(obj, ctx.language)
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                "Read successful",
                object_id=str(object_id),
                object_type=STORY_ENTITY_FOLDER_TYPE,
                data={
                    "object": {
                        "name": lang_data.get("name"),
                        "description": lang_data.get("description"),
                        "parentId": obj.get("metadata", {}).get("parent_id"),
                        "position": obj.get("metadata", {}).get("display_order"),
                    }
                },
            ),
        )

    async def _validate_create_story_entity_folder(self, args, ctx):
        try:
            ensure_story_entity_folder_exists(
                ctx.db,
                project_id=ctx.project_id,
                folder_id=args.get("parentId"),
                field_name="parentId",
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_create_story_entity_folder", str(exc))

    async def _execute_create_story_entity_folder(self, args, ctx):
        created = object_service.create_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type=STORY_ENTITY_FOLDER_TYPE,
            data={
                "name": str(args.get("name") or ""),
                "description": str(args.get("description") or ""),
            },
            language=ctx.language,
            metadata={"parent_id": args.get("parentId")},
            user_request="tool:create_story_entity_folder",
            created_by=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                "Created story entity folder",
                object_id=created["id"],
                object_type=STORY_ENTITY_FOLDER_TYPE,
            ),
        )

    async def _validate_delete_story_entity_folder(self, args, ctx):
        try:
            read_story_entity_folder(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_delete_story_entity_folder", str(exc))

    async def _execute_delete_story_entity_folder(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        object_service.delete_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type=STORY_ENTITY_FOLDER_TYPE,
            object_id=object_id,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                "Deleted story entity folder",
                object_id=str(object_id),
                object_type=STORY_ENTITY_FOLDER_TYPE,
            ),
        )

    async def _validate_replace_story_entity(self, args, ctx):
        try:
            read_runtime_story_entity(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
                kind=args.get("kind"),
            )
            ensure_story_entity_folder_exists(
                ctx.db,
                project_id=ctx.project_id,
                folder_id=args.get("folderId"),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_replace_story_entity", str(exc))

    async def _validate_patch_story_entity(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description", "content"}:
                raise ValueError("field must be one of name|description|content")
            current = read_runtime_story_entity(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
                kind=args.get("kind"),
            )
            ensure_story_entity_folder_exists(
                ctx.db,
                project_id=ctx.project_id,
                folder_id=args.get("folderId"),
            )
            patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(field),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_story_entity", str(exc))

    async def _validate_translate_story_entity(self, args, ctx):
        try:
            read_runtime_story_entity(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
                kind=args.get("kind"),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_translate_story_entity", str(exc))

    async def _validate_patch_translation_story_entity(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description", "content"}:
                raise ValueError("field must be one of name|description|content")
            current = read_runtime_story_entity(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
                kind=args.get("kind"),
            )
            patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(field),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_translation_story_entity", str(exc))

    async def _validate_replace_story_entity_folder(self, args, ctx):
        try:
            if not _has_any_story_entity_folder_replace_field(args):
                raise ValueError("replace_story_entity_folder requires at least one of name, description, parentId, or position")
            _non_negative_position(args.get("position"))
            read_story_entity_folder(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            ensure_story_entity_folder_exists(
                ctx.db,
                project_id=ctx.project_id,
                folder_id=args.get("parentId"),
                field_name="parentId",
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_replace_story_entity_folder", str(exc))

    async def _validate_patch_story_entity_folder(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description"}:
                raise ValueError("field must be one of name|description")
            _non_negative_position(args.get("position"))
            current = read_story_entity_folder(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            ensure_story_entity_folder_exists(
                ctx.db,
                project_id=ctx.project_id,
                folder_id=args.get("parentId"),
                field_name="parentId",
            )
            patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(field),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_story_entity_folder", str(exc))

    async def _validate_translate_story_entity_folder(self, args, ctx):
        try:
            if not any(key in args for key in ("name", "description")):
                raise ValueError("translate_story_entity_folder requires at least one of name or description")
            read_story_entity_folder(
                ctx.db,
                project_id=ctx.project_id,
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_translate_story_entity_folder", str(exc))

    async def _validate_patch_translation_story_entity_folder(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description"}:
                raise ValueError("field must be one of name|description")
            current = read_story_entity_folder(
                ctx.db,
                project_id=ctx.project_id,
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
            return invalid_result("validate_patch_translation_story_entity_folder", str(exc))

from __future__ import annotations

from typing import Any
from uuid import UUID

from ..contracts import (
    PersistedToolMeta,
    ToolBinding,
    ToolBindingMeta,
    ToolExecutionOutcome,
    ToolFeatureModule,
    ToolSpec,
)
from ..registry import tool_feature_module
from ..result_utils import invalid_result, make_result, valid_result
from .feature_common import filter_allowed_bindings, merge_key_for
from .object_access import extract_lang_data, patch_object_field, read_object, read_runtime_object, to_uuid
from .shared import filter_allowed_specs, is_non_journey, is_translation_journey, obj_schema
from ....models.db_models import TimelineEventLink
from ....services.object_service import object_service
from ....services.timeline_service import ALLOWED_LINK_TYPES, _UNSET, timeline_service
from ....utils.timeline_calendar import default_calendar


_ID = {"type": "string", "description": "Object ID"}
_TRACK_ID = {"type": "string", "description": "Timeline track ID"}
_POSITION = {"type": "integer", "description": "Zero-based sibling position"}
_PARENT_ID = {"type": "string", "description": "Parent track ID or null", "nullable": True}
_COLOR = {"type": "string", "description": "Optional track color", "nullable": True}
_TAGS = {"type": "array", "items": {"type": "string"}}


def _date_schema(db, project_id) -> dict[str, Any]:
    timeline = timeline_service.get_timeline(db, project_id=project_id)
    calendar = timeline.calendar if timeline and isinstance(timeline.calendar, dict) else default_calendar()
    units = calendar.get("units")
    if not units:
        units = default_calendar()["units"]

    properties: dict[str, Any] = {}
    desc_parts: list[str] = []
    for i, u in enumerate(units):
        name = u.get("name", "")
        if not name:
            continue
        prop: dict[str, Any] = {"type": "integer", "minimum": 0}
        if i > 0:
            parent_count = units[i - 1].get("count")
            if parent_count is not None:
                prop["maximum"] = int(parent_count) - 1
                desc_parts.append(f"{name} (0\u2013{int(parent_count) - 1})")
            else:
                desc_parts.append(f"{name} (0+, unbounded)")
        else:
            desc_parts.append(f"{name} (0+, unbounded)")
        properties[name] = prop

    return {
        "type": "object",
        "description": f"Date object. Ranges: {', '.join(desc_parts)}",
        "properties": properties,
        "required": list(properties.keys())[:1],
    }


def _safe_target_id(args: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = args.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _timeline_data_fields(args: dict[str, Any]) -> dict[str, str]:
    return {
        "name": str(args.get("name") or ""),
        "description": str(args.get("description") or ""),
        "content": str(args.get("content") or ""),
    }


def _persisted_meta(
    *,
    category: str,
    op: str,
    target_kind: str,
    target_key: str = "id",
    grouped: bool = False,
):
    def _builder(ctx, args: dict[str, Any]) -> PersistedToolMeta:
        target_id = _safe_target_id(args, target_key)
        language = str(getattr(ctx.run, "language", "") or "English")
        return PersistedToolMeta(
            feature_key="timeline",
            category=category,
            op=op,
            target_kind=target_kind,
            target_id=target_id,
            merge_key=merge_key_for(category, target_kind=target_kind, target_id=target_id, language=language) if grouped else None,
        )

    return _builder


def _binding(
    *,
    spec: ToolSpec,
    meta: ToolBindingMeta,
    validate,
    execute,
    build_persisted_meta,
) -> ToolBinding:
    async def _validate(args, ctx):
        return await validate(args, ctx)

    async def _execute(args, ctx):
        return await execute(args, ctx)

    return ToolBinding(
        spec=spec,
        meta=meta,
        validate=_validate,
        execute=_execute,
        build_persisted_meta=build_persisted_meta,
    )

def _normal_specs(ctx) -> list[ToolSpec]:
    date = _date_schema(ctx.db, ctx.project_id)
    return filter_allowed_specs(
        ctx,
        [
            ToolSpec(
                name="read_timeline",
                description="Read the project timeline with tracks, events, dates, and links.",
                parameters=obj_schema({}, []),
                auto_approve_category="read",
            ),
            ToolSpec(
                name="read_timeline_event",
                description="Read a single timeline event.",
                parameters=obj_schema({"id": _ID}, ["id"]),
                auto_approve_category="read",
            ),
            ToolSpec(
                name="create_timeline_track",
                description="Create a timeline track.",
                parameters=obj_schema(
                    {
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "content": {"type": "string", "description": "Rich text content (markdown)"},
                        "parentId": _PARENT_ID,
                        "position": _POSITION,
                        "color": _COLOR,
                    },
                    ["name"],
                ),
                auto_approve_category="write",
            ),
            ToolSpec(
                name="create_timeline_event",
                description="Create a timeline event on a track.",
                parameters=obj_schema(
                    {
                        "trackId": _TRACK_ID,
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "content": {"type": "string", "description": "Rich text content (markdown)"},
                        "startDate": date,
                        "endDate": {**date, "nullable": True},
                        "tags": _TAGS,
                    },
                    ["trackId", "name", "startDate"],
                ),
                auto_approve_category="write",
            ),
            ToolSpec(
                name="patch_timeline_track",
                description="Update track content or appearance.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "content": {"type": "string", "description": "Rich text content (markdown)"},
                        "color": _COLOR,
                    },
                    ["id"],
                ),
                auto_approve_category="write",
            ),
            ToolSpec(
                name="patch_timeline_event",
                description="Update timeline event content, dates, track, or tags.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "trackId": _TRACK_ID,
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "content": {"type": "string", "description": "Rich text content (markdown)"},
                        "startDate": date,
                        "endDate": {**date, "nullable": True},
                        "tags": _TAGS,
                    },
                    ["id"],
                ),
                auto_approve_category="write",
            ),
            ToolSpec(
                name="delete_timeline_track",
                description="Delete a timeline track and all descendant tracks/events.",
                parameters=obj_schema({"id": _ID}, ["id"]),
                auto_approve_category="delete",
            ),
            ToolSpec(
                name="delete_timeline_event",
                description="Delete a timeline event.",
                parameters=obj_schema({"id": _ID}, ["id"]),
                auto_approve_category="delete",
            ),
            ToolSpec(
                name="create_timeline_event_link",
                description="Link a timeline event to an outline or story entity.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "objectType": {"type": "string", "enum": sorted(ALLOWED_LINK_TYPES)},
                        "objectId": _ID,
                    },
                    ["id", "objectType", "objectId"],
                ),
                auto_approve_category="write",
            ),
            ToolSpec(
                name="delete_timeline_event_link",
                description="Delete a link from a timeline event.",
                parameters=obj_schema({"id": _ID, "linkId": _ID}, ["id", "linkId"]),
                auto_approve_category="delete",
            ),
        ],
    )


def _translation_specs(ctx) -> list[ToolSpec]:
    if not is_translation_journey(ctx):
        return []
    return filter_allowed_specs(
        ctx,
        [
            ToolSpec(
                name="translate_timeline_track",
                description="Translate timeline track fields.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "content": {"type": "string", "description": "Translated rich text content (markdown)"},
                    },
                    ["id", "name", "description"],
                ),
                auto_approve_category="translate",
            ),
            ToolSpec(
                name="translate_timeline_event",
                description="Translate timeline event fields.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "content": {"type": "string", "description": "Translated rich text content (markdown)"},
                    },
                    ["id", "name", "description"],
                ),
                auto_approve_category="translate",
            ),
            ToolSpec(
                name="patch_translation_timeline_track",
                description="Patch a timeline track translation by single replacement.",
                parameters=obj_schema(
                    {"id": _ID, "field": {"type": "string", "enum": ["name", "description", "content"]}, "old": {"type": "string"}, "new": {"type": "string"}},
                    ["id", "field", "old", "new"],
                ),
                auto_approve_category="patch_translation",
            ),
            ToolSpec(
                name="patch_translation_timeline_event",
                description="Patch a timeline event translation by single replacement.",
                parameters=obj_schema(
                    {"id": _ID, "field": {"type": "string", "enum": ["name", "description", "content"]}, "old": {"type": "string"}, "new": {"type": "string"}},
                    ["id", "field", "old", "new"],
                ),
                auto_approve_category="patch_translation",
            ),
        ],
    )


@tool_feature_module()
class TimelineFeatureModule(ToolFeatureModule):
    feature_key = "timeline"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        if not (is_non_journey(ctx) or is_translation_journey(ctx)):
            return []

        bindings: list[ToolBinding] = []
        normal_specs_by_name = {spec.name: spec for spec in _normal_specs(ctx)}
        translation_specs_by_name = {spec.name: spec for spec in _translation_specs(ctx)}

        def add_binding(
            *,
            spec_map: dict[str, ToolSpec],
            name: str,
            meta: ToolBindingMeta,
            validate,
            execute,
            build_persisted_meta,
        ) -> None:
            spec = spec_map.get(name)
            if spec is None:
                return
            bindings.append(
                _binding(
                    spec=spec,
                    meta=meta,
                    validate=validate,
                    execute=execute,
                    build_persisted_meta=build_persisted_meta,
                )
            )

        if is_non_journey(ctx):
            add_binding(
                spec_map=normal_specs_by_name,
                name="read_timeline",
                meta=ToolBindingMeta(feature_key="timeline", category="read", op="read", target_kind="timeline_track"),
                validate=self._validate_read_timeline,
                execute=self._execute_read_timeline,
                build_persisted_meta=_persisted_meta(category="read", op="read", target_kind="timeline_track"),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="read_timeline_event",
                meta=ToolBindingMeta(feature_key="timeline", category="read", op="read", target_kind="timeline_event"),
                validate=self._validate_read_timeline_event,
                execute=self._execute_read_timeline_event,
                build_persisted_meta=_persisted_meta(category="read", op="read", target_kind="timeline_event"),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="create_timeline_track",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="create", target_kind="timeline_track"),
                validate=self._validate_create_timeline_track,
                execute=self._execute_create_timeline_track,
                build_persisted_meta=_persisted_meta(category="write", op="create", target_kind="timeline_track"),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="create_timeline_event",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="create", target_kind="timeline_event"),
                validate=self._validate_create_timeline_event,
                execute=self._execute_create_timeline_event,
                build_persisted_meta=_persisted_meta(category="write", op="create", target_kind="timeline_event"),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="patch_timeline_track",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="patch", target_kind="timeline_track"),
                validate=self._validate_patch_timeline_track,
                execute=self._execute_patch_timeline_track,
                build_persisted_meta=_persisted_meta(category="write", op="patch", target_kind="timeline_track", grouped=True),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="patch_timeline_event",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="patch", target_kind="timeline_event"),
                validate=self._validate_patch_timeline_event,
                execute=self._execute_patch_timeline_event,
                build_persisted_meta=_persisted_meta(category="write", op="patch", target_kind="timeline_event", grouped=True),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="delete_timeline_track",
                meta=ToolBindingMeta(feature_key="timeline", category="delete", op="delete", target_kind="timeline_track"),
                validate=self._validate_delete_timeline_track,
                execute=self._execute_delete_timeline_track,
                build_persisted_meta=_persisted_meta(category="delete", op="delete", target_kind="timeline_track"),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="delete_timeline_event",
                meta=ToolBindingMeta(feature_key="timeline", category="delete", op="delete", target_kind="timeline_event"),
                validate=self._validate_delete_timeline_event,
                execute=self._execute_delete_timeline_event,
                build_persisted_meta=_persisted_meta(category="delete", op="delete", target_kind="timeline_event"),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="create_timeline_event_link",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="create", target_kind="timeline_event"),
                validate=self._validate_create_timeline_event_link,
                execute=self._execute_create_timeline_event_link,
                build_persisted_meta=_persisted_meta(category="write", op="create", target_kind="timeline_event", grouped=True),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="delete_timeline_event_link",
                meta=ToolBindingMeta(feature_key="timeline", category="delete", op="delete", target_kind="timeline_event"),
                validate=self._validate_delete_timeline_event_link,
                execute=self._execute_delete_timeline_event_link,
                build_persisted_meta=_persisted_meta(category="delete", op="delete", target_kind="timeline_event"),
            )

        if is_translation_journey(ctx):
            for name, op, target_kind, validate, execute in (
                ("translate_timeline_track", "translate", "timeline_track", self._validate_translate_timeline_track, self._execute_translate_timeline_track),
                ("translate_timeline_event", "translate", "timeline_event", self._validate_translate_timeline_event, self._execute_translate_timeline_event),
                (
                    "patch_translation_timeline_track",
                    "patch_translation",
                    "timeline_track",
                    self._validate_patch_translation_timeline_track,
                    self._execute_patch_translation_timeline_track,
                ),
                (
                    "patch_translation_timeline_event",
                    "patch_translation",
                    "timeline_event",
                    self._validate_patch_translation_timeline_event,
                    self._execute_patch_translation_timeline_event,
                ),
            ):
                add_binding(
                    spec_map=translation_specs_by_name,
                    name=name,
                    meta=ToolBindingMeta(
                        feature_key="timeline",
                        category="translate",
                        op=op,
                        target_kind=target_kind,
                    ),
                    validate=validate,
                    execute=execute,
                    build_persisted_meta=_persisted_meta(
                        category="translate",
                        op=op,
                        target_kind=target_kind,
                        grouped=True,
                    ),
                )

        return filter_allowed_bindings(ctx, bindings)

    async def _validate_read_timeline(self, args, ctx):
        _ = args
        _ = ctx
        return valid_result()

    async def _execute_read_timeline(self, args, ctx):
        _ = args
        timeline = timeline_service.get_full_timeline(
            ctx.db,
            project_id=ctx.project_id,
            language=ctx.language,
            ensure_exists=True,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Timeline retrieved", data={"timeline": timeline}),
        )

    async def _validate_read_timeline_event(self, args, ctx):
        try:
            event_id = to_uuid(args.get("id"), "id")
            event = object_service.get_object(
                ctx.db,
                object_type="timeline_event",
                object_id=event_id,
                project_id=ctx.project_id,
                language=ctx.language,
            )
            if event is None:
                raise ValueError("timeline_event not found")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_read_timeline_event", str(exc))

    async def _execute_read_timeline_event(self, args, ctx):
        event_id = to_uuid(args.get("id"), "id")
        event = object_service.get_object(
            ctx.db,
            object_type="timeline_event",
            object_id=event_id,
            project_id=ctx.project_id,
            language=ctx.language,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Timeline event retrieved", object_id=str(event_id), object_type="timeline_event", data={"event": event}),
        )

    @staticmethod
    def _clean_optional_id(value) -> str | None:
        """Normalise null-like strings that LLMs sometimes emit."""
        if value is None:
            return None
        s = str(value).strip().lower()
        if s in ("", "null", "none", ":null"):
            return None
        return str(value).strip()

    async def _validate_create_timeline_track(self, args, ctx):
        _ = ctx
        try:
            if not str(args.get("name") or "").strip():
                raise ValueError("name is required")
            pid = self._clean_optional_id(args.get("parentId"))
            if pid:
                to_uuid(pid, "parentId")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_create_timeline_track", str(exc))

    async def _execute_create_timeline_track(self, args, ctx):
        pid = self._clean_optional_id(args.get("parentId"))
        result = timeline_service.create_track(
            ctx.db,
            project_id=ctx.project_id,
            language=ctx.language,
            name=str(args.get("name") or ""),
            description=str(args.get("description") or ""),
            content=str(args.get("content") or "") if args.get("content") else None,
            rich_text_format="markdown",
            parent_id=to_uuid(pid, "parentId") if pid else None,
            position=args.get("position") if isinstance(args.get("position"), int) else None,
            color=str(args.get("color") or "") if args.get("color") is not None else None,
            user_request="tool:create_timeline_track",
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Created timeline track", object_id=result["id"], object_type="timeline_track"),
        )

    async def _validate_create_timeline_event(self, args, ctx):
        _ = ctx
        try:
            to_uuid(args.get("trackId"), "trackId")
            if not str(args.get("name") or "").strip():
                raise ValueError("name is required")
            if not isinstance(args.get("startDate"), dict):
                raise ValueError("startDate must be an object")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_create_timeline_event", str(exc))

    async def _execute_create_timeline_event(self, args, ctx):
        result = timeline_service.create_event(
            ctx.db,
            project_id=ctx.project_id,
            track_id=to_uuid(args.get("trackId"), "trackId"),
            language=ctx.language,
            name=str(args.get("name") or ""),
            description=str(args.get("description") or ""),
            content=str(args.get("content") or "") if args.get("content") else None,
            rich_text_format="markdown",
            start_date=dict(args.get("startDate") or {}),
            end_date=dict(args["endDate"]) if isinstance(args.get("endDate"), dict) else None,
            tags=list(args.get("tags") or []),
            user_request="tool:create_timeline_event",
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Created timeline event", object_id=result["id"], object_type="timeline_event"),
        )

    async def _validate_patch_timeline_track(self, args, ctx):
        try:
            track_id = to_uuid(args.get("id"), "id")
            if not any(key in args for key in ("name", "description", "content", "color")):
                raise ValueError("patch_timeline_track requires at least one field")
            track = object_service.get_object(
                ctx.db,
                object_type="timeline_track",
                object_id=track_id,
                project_id=ctx.project_id,
                language=ctx.language,
            )
            if track is None:
                raise ValueError("timeline_track not found")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_timeline_track", str(exc))

    async def _execute_patch_timeline_track(self, args, ctx):
        result = timeline_service.update_track(
            ctx.db,
            project_id=ctx.project_id,
            track_id=to_uuid(args.get("id"), "id"),
            language=ctx.language if any(key in args for key in ("name", "description", "content")) else None,
            name=str(args.get("name") or "") if "name" in args else None,
            description=str(args.get("description") or "") if "description" in args else None,
            content=str(args.get("content") or "") if "content" in args else _UNSET,
            rich_text_format="markdown",
            color=(str(args.get("color") or "") if args.get("color") is not None else None) if "color" in args else _UNSET,
            user_request="tool:patch_timeline_track",
            create_new_version=True,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Updated timeline track", object_id=result["id"], object_type="timeline_track"),
        )

    async def _validate_patch_timeline_event(self, args, ctx):
        try:
            event_id = to_uuid(args.get("id"), "id")
            if not any(key in args for key in ("trackId", "name", "description", "content", "startDate", "endDate", "tags")):
                raise ValueError("patch_timeline_event requires at least one field")
            if "trackId" in args:
                to_uuid(args.get("trackId"), "trackId")
            event = object_service.get_object(
                ctx.db,
                object_type="timeline_event",
                object_id=event_id,
                project_id=ctx.project_id,
                language=ctx.language,
            )
            if event is None:
                raise ValueError("timeline_event not found")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_patch_timeline_event", str(exc))

    async def _execute_patch_timeline_event(self, args, ctx):
        result = timeline_service.update_event(
            ctx.db,
            project_id=ctx.project_id,
            event_id=to_uuid(args.get("id"), "id"),
            track_id=to_uuid(args.get("trackId"), "trackId") if "trackId" in args else None,
            language=ctx.language if any(key in args for key in ("name", "description", "content")) else None,
            name=str(args.get("name") or "") if "name" in args else None,
            description=str(args.get("description") or "") if "description" in args else None,
            content=str(args.get("content") or "") if "content" in args else _UNSET,
            rich_text_format="markdown",
            start_date=dict(args.get("startDate") or {}) if "startDate" in args else _UNSET,
            end_date=(dict(args["endDate"]) if isinstance(args.get("endDate"), dict) else None) if "endDate" in args else _UNSET,
            tags=list(args.get("tags") or []) if "tags" in args else _UNSET,
            user_request="tool:patch_timeline_event",
            create_new_version=True,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Updated timeline event", object_id=result["id"], object_type="timeline_event"),
        )

    async def _validate_delete_timeline_track(self, args, ctx):
        try:
            track_id = to_uuid(args.get("id"), "id")
            track = object_service.get_object(
                ctx.db,
                object_type="timeline_track",
                object_id=track_id,
                project_id=ctx.project_id,
                language=ctx.language,
            )
            if track is None:
                raise ValueError("timeline_track not found")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_delete_timeline_track", str(exc))

    async def _execute_delete_timeline_track(self, args, ctx):
        track_id = to_uuid(args.get("id"), "id")
        timeline_service.delete_track(ctx.db, project_id=ctx.project_id, track_id=track_id, user_id=ctx.user_id)
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Deleted timeline track", object_id=str(track_id), object_type="timeline_track"),
        )

    async def _validate_delete_timeline_event(self, args, ctx):
        try:
            event_id = to_uuid(args.get("id"), "id")
            event = object_service.get_object(
                ctx.db,
                object_type="timeline_event",
                object_id=event_id,
                project_id=ctx.project_id,
                language=ctx.language,
            )
            if event is None:
                raise ValueError("timeline_event not found")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_delete_timeline_event", str(exc))

    async def _execute_delete_timeline_event(self, args, ctx):
        event_id = to_uuid(args.get("id"), "id")
        timeline_service.delete_event(ctx.db, project_id=ctx.project_id, event_id=event_id, user_id=ctx.user_id)
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Deleted timeline event", object_id=str(event_id), object_type="timeline_event"),
        )

    async def _validate_create_timeline_event_link(self, args, ctx):
        try:
            event_id = to_uuid(args.get("id"), "id")
            object_type = str(args.get("objectType") or "")
            if object_type not in ALLOWED_LINK_TYPES:
                raise ValueError("objectType must be outline or story_entity")
            to_uuid(args.get("objectId"), "objectId")
            event = object_service.get_object(
                ctx.db,
                object_type="timeline_event",
                object_id=event_id,
                project_id=ctx.project_id,
                language=ctx.language,
            )
            if event is None:
                raise ValueError("timeline_event not found")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_create_timeline_event_link", str(exc))

    async def _execute_create_timeline_event_link(self, args, ctx):
        event_id = to_uuid(args.get("id"), "id")
        object_id = to_uuid(args.get("objectId"), "objectId")
        link = timeline_service.link_event(
            ctx.db,
            project_id=ctx.project_id,
            event_id=event_id,
            object_type=str(args.get("objectType") or ""),
            object_id=object_id,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                "Linked timeline event",
                object_id=str(event_id),
                object_type="timeline_event",
                data={"linkId": link["id"]},
            ),
        )

    async def _validate_delete_timeline_event_link(self, args, ctx):
        try:
            event_id = to_uuid(args.get("id"), "id")
            link_id = to_uuid(args.get("linkId"), "linkId")
            event = object_service.get_object(
                ctx.db,
                object_type="timeline_event",
                object_id=event_id,
                project_id=ctx.project_id,
                language=ctx.language,
            )
            if event is None:
                raise ValueError("timeline_event not found")
            link = (
                ctx.db.query(TimelineEventLink)
                .filter(TimelineEventLink.id == link_id, TimelineEventLink.event_id == event_id)
                .first()
            )
            if link is None:
                raise ValueError("timeline event link not found")
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_delete_timeline_event_link", str(exc))

    async def _execute_delete_timeline_event_link(self, args, ctx):
        event_id = to_uuid(args.get("id"), "id")
        link_id = to_uuid(args.get("linkId"), "linkId")
        timeline_service.unlink_event(
            ctx.db,
            project_id=ctx.project_id,
            event_id=event_id,
            link_id=link_id,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Deleted timeline event link", object_id=str(event_id), object_type="timeline_event"),
        )

    async def _validate_translate_timeline_track(self, args, ctx):
        try:
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_track",
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_translate_timeline_track", str(exc))

    async def _execute_translate_timeline_track(self, args, ctx):
        result = timeline_service.update_track(
            ctx.db,
            project_id=ctx.project_id,
            track_id=to_uuid(args.get("id"), "id"),
            language=ctx.language,
            name=str(args.get("name") or ""),
            description=str(args.get("description") or ""),
            content=str(args.get("content") or "") if "content" in args else _UNSET,
            rich_text_format="markdown",
            color=_UNSET,
            user_request="tool:translate_timeline_track",
            create_new_version=False,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Translated timeline track", object_id=result["id"], object_type="timeline_track"),
        )

    async def _validate_translate_timeline_event(self, args, ctx):
        try:
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_event",
                object_id=to_uuid(args.get("id"), "id"),
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_translate_timeline_event", str(exc))

    async def _execute_translate_timeline_event(self, args, ctx):
        result = timeline_service.update_event(
            ctx.db,
            project_id=ctx.project_id,
            event_id=to_uuid(args.get("id"), "id"),
            track_id=None,
            language=ctx.language,
            name=str(args.get("name") or ""),
            description=str(args.get("description") or ""),
            content=str(args.get("content") or "") if "content" in args else _UNSET,
            rich_text_format="markdown",
            start_date=_UNSET,
            end_date=_UNSET,
            tags=_UNSET,
            user_request="tool:translate_timeline_event",
            create_new_version=False,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Translated timeline event", object_id=result["id"], object_type="timeline_event"),
        )

    async def _validate_patch_translation_timeline_track(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description", "content"}:
                raise ValueError("field must be one of name|description|content")
            current = read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_track",
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
            return invalid_result("validate_patch_translation_timeline_track", str(exc))

    async def _execute_patch_translation_timeline_track(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        current = read_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type="timeline_track",
            object_id=object_id,
            language=ctx.language,
            rich_text_format="markdown",
        )
        next_data = patch_object_field(
            extract_lang_data(current, ctx.language),
            field=str(args.get("field") or ""),
            old=str(args.get("old") or ""),
            new=str(args.get("new") or ""),
        )
        result = timeline_service.update_track(
            ctx.db,
            project_id=ctx.project_id,
            track_id=object_id,
            language=ctx.language,
            name=str(next_data.get("name") or ""),
            description=str(next_data.get("description") or ""),
            content=next_data.get("content", _UNSET),
            rich_text_format="markdown",
            color=_UNSET,
            user_request="tool:patch_translation_timeline_track",
            create_new_version=False,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Patched timeline track translation", object_id=result["id"], object_type="timeline_track"),
        )

    async def _validate_patch_translation_timeline_event(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description", "content"}:
                raise ValueError("field must be one of name|description|content")
            current = read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_event",
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
            return invalid_result("validate_patch_translation_timeline_event", str(exc))

    async def _execute_patch_translation_timeline_event(self, args, ctx):
        object_id = to_uuid(args.get("id"), "id")
        current = read_object(
            ctx.db,
            project_id=ctx.project_id,
            object_type="timeline_event",
            object_id=object_id,
            language=ctx.language,
            rich_text_format="markdown",
        )
        next_data = patch_object_field(
            extract_lang_data(current, ctx.language),
            field=str(args.get("field") or ""),
            old=str(args.get("old") or ""),
            new=str(args.get("new") or ""),
        )
        result = timeline_service.update_event(
            ctx.db,
            project_id=ctx.project_id,
            event_id=object_id,
            track_id=None,
            language=ctx.language,
            name=str(next_data.get("name") or ""),
            description=str(next_data.get("description") or ""),
            content=next_data.get("content", _UNSET),
            rich_text_format="markdown",
            start_date=_UNSET,
            end_date=_UNSET,
            tags=_UNSET,
            user_request="tool:patch_translation_timeline_event",
            create_new_version=False,
            user_id=ctx.user_id,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Patched timeline event translation", object_id=result["id"], object_type="timeline_event"),
        )

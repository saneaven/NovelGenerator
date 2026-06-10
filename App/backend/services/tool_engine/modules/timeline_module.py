from __future__ import annotations

from typing import Any
from uuid import UUID

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
from .object_access import extract_lang_data, patch_object_field, read_object, read_runtime_object, to_uuid
from .shared import filter_allowed_specs, is_non_journey, is_translation_journey, obj_schema
from ....models.db_models import Timeline, TimelineEvent, TimelineEventLink, TimelineTrack
from ....services.object_service import object_service
from ....services.timeline_service import ALLOWED_LINK_TYPES, _UNSET, timeline_service
from ....utils.timeline_calendar import default_calendar, is_gregorian_calendar, to_base_units, validate_date


_ID = {"type": "string", "description": "Object ID"}
_TRACK_ID = {"type": "string", "description": "Timeline track ID"}
_POSITION = {"type": "integer", "description": "Zero-based sibling position"}
_PARENT_ID = {"type": ["string", "null"], "description": "Parent track ID or null"}
_COLOR = {"type": ["string", "null"], "description": "Optional track color"}
_TAGS = {"type": "array", "items": {"type": "string"}}
_PATCH_FIELD = {"type": "string", "enum": ["name", "description", "content"]}


def _date_schema(db, project_id) -> dict[str, Any]:
    timeline = timeline_service.get_timeline(db, project_id=project_id)
    calendar = timeline.calendar if timeline and isinstance(timeline.calendar, dict) else default_calendar()
    units = calendar.get("units")
    if not units:
        units = default_calendar()["units"]

    if is_gregorian_calendar(calendar):
        return {
            "type": "object",
            "description": (
                "Gregorian date object. Required: year, month, day. "
                "hour/minute default to 1 when omitted. day must be a real valid day for the given year/month; "
                "the server validates leap years and month lengths."
            ),
            "properties": {
                "year": {"type": "integer", "minimum": 1},
                "month": {"type": "integer", "minimum": 1, "maximum": 12},
                "day": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 31,
                    "description": "Must be valid for year/month, including leap-year February.",
                },
                "hour": {"type": "integer", "minimum": 1, "maximum": 24},
                "minute": {"type": "integer", "minimum": 1, "maximum": 60},
            },
            "required": ["year", "month", "day"],
        }

    properties: dict[str, Any] = {}
    desc_parts: list[str] = []
    for i, u in enumerate(units):
        name = u.get("name", "")
        if not name:
            continue
        prop: dict[str, Any] = {"type": "integer", "minimum": 1}
        if i > 0:
            parent_count = units[i - 1].get("count")
            if parent_count is not None:
                prop["maximum"] = int(parent_count)
                desc_parts.append(f"{name} (1\u2013{int(parent_count)})")
            else:
                desc_parts.append(f"{name} (1+, unbounded)")
        else:
            desc_parts.append(f"{name} (1+, unbounded)")
        properties[name] = prop

    return {
        "type": "object",
        "description": f"Date object. Ranges: {', '.join(desc_parts)}",
        "properties": properties,
        "required": list(properties.keys())[:1],
    }


def _calendar_for_track_id(db, *, project_id: UUID, track_id: UUID) -> dict[str, Any]:
    if not hasattr(db, "query"):
        return default_calendar()
    timeline = (
        db.query(Timeline)
        .join(TimelineTrack, TimelineTrack.timeline_id == Timeline.id)
        .filter(TimelineTrack.id == track_id, Timeline.project_id == project_id)
        .first()
    )
    if timeline is None:
        raise ValueError("Timeline track not found")
    return timeline.calendar if isinstance(timeline.calendar, dict) else default_calendar()


def _timeline_for_event_id(db, *, project_id: UUID, event_id: UUID) -> Timeline | None:
    if not hasattr(db, "query"):
        return None
    return (
        db.query(Timeline)
        .join(TimelineTrack, TimelineTrack.timeline_id == Timeline.id)
        .join(TimelineEvent, TimelineEvent.track_id == TimelineTrack.id)
        .filter(TimelineEvent.id == event_id, Timeline.project_id == project_id)
        .first()
    )


def _event_row_for_validation(db, *, project_id: UUID, event_id: UUID) -> TimelineEvent | None:
    if not hasattr(db, "query"):
        return None
    return (
        db.query(TimelineEvent)
        .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(TimelineEvent.id == event_id, Timeline.project_id == project_id)
        .first()
    )


def _calendar_for_event_update(
    db,
    *,
    project_id: UUID,
    event_id: UUID | None,
    track_id: UUID | None,
) -> dict[str, Any]:
    if track_id is not None:
        return _calendar_for_track_id(db, project_id=project_id, track_id=track_id)
    if event_id is None:
        return default_calendar()
    timeline = _timeline_for_event_id(db, project_id=project_id, event_id=event_id)
    if timeline is None:
        if hasattr(db, "query"):
            raise ValueError("timeline_event not found")
        return default_calendar()
    return timeline.calendar if isinstance(timeline.calendar, dict) else default_calendar()


def _validate_tool_event_dates(
    *,
    calendar: dict[str, Any],
    start_date: Any,
    end_date: Any,
    validate_start: bool,
    validate_end: bool,
) -> None:
    if validate_start and not validate_date(start_date, calendar):
        raise ValueError("Invalid startDate for calendar")
    if validate_end and end_date is not None and not validate_date(end_date, calendar):
        raise ValueError("Invalid endDate for calendar")
    if isinstance(start_date, dict) and isinstance(end_date, dict):
        if validate_date(start_date, calendar) and validate_date(end_date, calendar):
            if to_base_units(end_date, calendar) < to_base_units(start_date, calendar):
                raise ValueError("endDate cannot be before startDate")


def _safe_target_id(args: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = args.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


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


async def _grouped_execute(_args, _ctx):
    raise RuntimeError("Grouped timeline tools must execute via apply_group")


def _clean_optional_id(value) -> str | None:
    """Normalise null-like strings that LLMs sometimes emit."""
    if value is None:
        return None
    s = str(value).strip().lower()
    if s in ("", "null", "none", ":null"):
        return None
    return str(value).strip()


def _non_negative_position(value: Any) -> None:
    if value is None:
        return
    if isinstance(value, int) and value >= 0:
        return
    raise ValueError("position must be a non-negative integer")


def _has_any_track_replace_field(args: dict[str, Any]) -> bool:
    return any(key in args for key in ("name", "description", "content", "parentId", "position", "color"))


def _has_any_event_replace_field(args: dict[str, Any]) -> bool:
    return any(key in args for key in ("trackId", "name", "description", "content", "startDate", "endDate", "tags"))


def _metadata(item) -> dict[str, Any] | None:
    args = item.args
    meta: dict[str, Any] = {}
    if item.meta.target_kind == "timeline_track":
        if "parentId" in args:
            meta["parent_id"] = args.get("parentId")
        if isinstance(args.get("position"), int):
            meta["position"] = int(args["position"])
        if "color" in args:
            meta["color"] = args.get("color")
    elif item.meta.target_kind == "timeline_event":
        if "trackId" in args:
            meta["track_id"] = args.get("trackId")
        if "startDate" in args:
            meta["start_date"] = args.get("startDate")
        if "endDate" in args:
            meta["end_date"] = args.get("endDate")
        if "tags" in args:
            meta["tags"] = args.get("tags")
    return meta or None


def _replace_fields(item) -> dict[str, Any]:
    return {key: item.args[key] for key in ("name", "description", "content") if key in item.args}


def _validate_track_parent(
    db,
    *,
    project_id: UUID,
    track_id: UUID,
    parent_id: UUID | None,
) -> None:
    if parent_id is None:
        return
    if parent_id == track_id:
        raise ValueError("Track cannot be moved under itself")

    track = (
        db.query(TimelineTrack)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(TimelineTrack.id == track_id, Timeline.project_id == project_id)
        .first()
    )
    if track is None:
        raise ValueError("timeline_track not found")

    parent = (
        db.query(TimelineTrack)
        .filter(TimelineTrack.id == parent_id, TimelineTrack.timeline_id == track.timeline_id)
        .first()
    )
    if parent is None:
        raise ValueError("Parent track not found")

    rows = db.query(TimelineTrack).filter(TimelineTrack.timeline_id == track.timeline_id).all()
    children_by_parent: dict[UUID | None, list[UUID]] = {}
    for row in rows:
        children_by_parent.setdefault(row.parent_id, []).append(row.id)

    pending = list(children_by_parent.get(track_id, []))
    while pending:
        current = pending.pop(0)
        if current == parent_id:
            raise ValueError("Track cannot be moved under its descendant")
        pending.extend(children_by_parent.get(current, []))


def _validate_event_metadata_args(args: dict[str, Any], ctx, *, event_id: UUID | None = None) -> None:
    track_id: UUID | None = None
    if "trackId" in args:
        if _clean_optional_id(args.get("trackId")) is None:
            raise ValueError("trackId is required")
        track_id = to_uuid(args.get("trackId"), "trackId")
    if "startDate" in args and not isinstance(args.get("startDate"), dict):
        raise ValueError("startDate must be an object")
    if "endDate" in args and args.get("endDate") is not None and not isinstance(args.get("endDate"), dict):
        raise ValueError("endDate must be an object or null")
    if "tags" in args and not isinstance(args.get("tags"), list):
        raise ValueError("tags must be an array")

    if "startDate" in args or "endDate" in args:
        calendar = _calendar_for_event_update(
            ctx.db,
            project_id=ctx.project_id,
            event_id=event_id,
            track_id=track_id,
        )
        event_row = _event_row_for_validation(ctx.db, project_id=ctx.project_id, event_id=event_id) if event_id else None
        start_date = args.get("startDate") if "startDate" in args else getattr(event_row, "start_date", None)
        end_date = args.get("endDate") if "endDate" in args else getattr(event_row, "end_date", None)
        _validate_tool_event_dates(
            calendar=calendar,
            start_date=start_date,
            end_date=end_date,
            validate_start="startDate" in args,
            validate_end="endDate" in args,
        )


def _projection_text(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    return value if isinstance(value, str) else ""


def _timeline_track_projection(db, *, project_id: UUID, track_id: UUID, language: str) -> dict[str, Any]:
    obj = read_runtime_object(
        db,
        project_id=project_id,
        object_type="timeline_track",
        object_id=track_id,
        language=language,
    )
    data = extract_lang_data(obj, language)
    metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}

    child_rows = (
        db.query(TimelineTrack)
        .filter(TimelineTrack.parent_id == track_id)
        .order_by(TimelineTrack.position.asc(), TimelineTrack.created_at.asc(), TimelineTrack.id.asc())
        .all()
    )
    event_rows = (
        db.query(TimelineEvent)
        .filter(TimelineEvent.track_id == track_id)
        .order_by(TimelineEvent.created_at.asc(), TimelineEvent.id.asc())
        .all()
    )

    return {
        "name": _projection_text(data, "name"),
        "description": _projection_text(data, "description"),
        "content": _projection_text(data, "content"),
        "parentId": metadata.get("parent_id"),
        "position": metadata.get("position"),
        "color": metadata.get("color"),
        "childTrackIds": [str(row.id) for row in child_rows],
        "eventIds": [str(row.id) for row in event_rows],
    }


def _timeline_event_projection(db, *, project_id: UUID, event_id: UUID, language: str) -> dict[str, Any]:
    obj = read_runtime_object(
        db,
        project_id=project_id,
        object_type="timeline_event",
        object_id=event_id,
        language=language,
    )
    data = extract_lang_data(obj, language)
    metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
    link_rows = (
        db.query(TimelineEventLink)
        .filter(TimelineEventLink.event_id == event_id)
        .order_by(TimelineEventLink.created_at.asc(), TimelineEventLink.id.asc())
        .all()
    )

    return {
        "name": _projection_text(data, "name"),
        "description": _projection_text(data, "description"),
        "content": _projection_text(data, "content"),
        "trackId": metadata.get("track_id"),
        "startDate": metadata.get("start_date") if isinstance(metadata.get("start_date"), dict) else {},
        "endDate": metadata.get("end_date") if isinstance(metadata.get("end_date"), dict) else None,
        "tags": metadata.get("tags") if isinstance(metadata.get("tags"), list) else [],
        "links": [
            {
                "linkId": str(row.id),
                "objectType": str(row.object_type),
                "objectId": str(row.object_id),
            }
            for row in link_rows
        ],
    }


def _normal_specs(ctx) -> list[ToolSpec]:
    date = _date_schema(ctx.db, ctx.project_id)
    return filter_allowed_specs(
        ctx,
        [
            ToolSpec(
                name="read_timeline_event",
                description="Read a single timeline event with fields, dates, tags, and link IDs.",
                parameters=obj_schema({"id": _ID}, ["id"]),
                auto_approve_category="read",
            ),
            ToolSpec(
                name="read_timeline_track",
                description="Read a single timeline track with fields plus child track and event IDs.",
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
                    ["name", "description", "content"],
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
                    ["trackId", "name", "description", "content", "startDate"],
                ),
                auto_approve_category="write",
            ),
            ToolSpec(
                name="replace_timeline_track",
                description="Replace timeline track fields and metadata.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "content": {"type": "string", "description": "Rich text content (markdown)"},
                        "parentId": _PARENT_ID,
                        "position": _POSITION,
                        "color": _COLOR,
                    },
                    ["id"],
                ),
                auto_approve_category="write",
            ),
            ToolSpec(
                name="patch_timeline_track",
                description="Patch timeline track text fields by single replacement and optionally update metadata.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "field": _PATCH_FIELD,
                        "parentId": _PARENT_ID,
                        "position": _POSITION,
                        "color": _COLOR,
                        "old": {"type": "string"},
                        "new": {"type": "string"},
                    },
                    ["id", "field", "old", "new"],
                ),
                auto_approve_category="write",
            ),
            ToolSpec(
                name="replace_timeline_event",
                description="Replace timeline event fields and metadata.",
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
                name="patch_timeline_event",
                description="Patch timeline event text fields by single replacement and optionally update metadata.",
                parameters=obj_schema(
                    {
                        "id": _ID,
                        "field": _PATCH_FIELD,
                        "trackId": _TRACK_ID,
                        "startDate": date,
                        "endDate": {**date, "nullable": True},
                        "tags": _TAGS,
                        "old": {"type": "string"},
                        "new": {"type": "string"},
                    },
                    ["id", "field", "old", "new"],
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
                    ["id", "name", "description", "content"],
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
                    ["id", "name", "description", "content"],
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
                name="read_timeline_event",
                meta=ToolBindingMeta(feature_key="timeline", category="read", op="read", target_kind="timeline_event"),
                validate=self._validate_read_timeline_event,
                execute=self._execute_read_timeline_event,
                build_persisted_meta=_persisted_meta(category="read", op="read", target_kind="timeline_event"),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="read_timeline_track",
                meta=ToolBindingMeta(feature_key="timeline", category="read", op="read", target_kind="timeline_track"),
                validate=self._validate_read_timeline_track,
                execute=self._execute_read_timeline_track,
                build_persisted_meta=_persisted_meta(category="read", op="read", target_kind="timeline_track"),
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
                name="replace_timeline_track",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="replace", target_kind="timeline_track"),
                validate=self._validate_replace_timeline_track,
                execute=_grouped_execute,
                build_persisted_meta=_persisted_meta(category="write", op="replace", target_kind="timeline_track", grouped=True),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="patch_timeline_track",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="patch", target_kind="timeline_track"),
                validate=self._validate_patch_timeline_track,
                execute=_grouped_execute,
                build_persisted_meta=_persisted_meta(category="write", op="patch", target_kind="timeline_track", grouped=True),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="replace_timeline_event",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="replace", target_kind="timeline_event"),
                validate=self._validate_replace_timeline_event,
                execute=_grouped_execute,
                build_persisted_meta=_persisted_meta(category="write", op="replace", target_kind="timeline_event", grouped=True),
            )
            add_binding(
                spec_map=normal_specs_by_name,
                name="patch_timeline_event",
                meta=ToolBindingMeta(feature_key="timeline", category="write", op="patch", target_kind="timeline_event"),
                validate=self._validate_patch_timeline_event,
                execute=_grouped_execute,
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

    async def apply_group(self, *, group: ToolDecisionGroup, ctx) -> list[ToolExecutionResult]:
        patch_items = tuple(
            item
            for item in group.items
            if item.meta.op in {"replace", "patch"} and item.meta.target_kind in {"timeline_track", "timeline_event"}
        )
        patch_item_ids = {item.tool_call_id for item in patch_items}
        other_items = tuple(item for item in group.items if item.tool_call_id not in patch_item_ids)

        results: list[ToolExecutionResult] = []
        if patch_items:
            results.extend(
                await apply_object_batch_group(
                    group=ToolDecisionGroup(
                        feature_key=group.feature_key,
                        merge_key=group.merge_key,
                        items=patch_items,
                    ),
                    ctx=ctx,
                    object_type_for_item=lambda item: item.meta.target_kind,
                    replace_fields_for_item=_replace_fields,
                    metadata_for_item=_metadata,
                    result_for_item=lambda item: make_result(
                        f"Applied {item.binding.spec.name}",
                        object_id=item.meta.target_id,
                        object_type=item.meta.target_kind,
                    ),
                )
            )

        if other_items:
            results.extend(
                await super().apply_group(
                    group=ToolDecisionGroup(
                        feature_key=group.feature_key,
                        merge_key=group.merge_key,
                        items=other_items,
                    ),
                    ctx=ctx,
                )
            )

        results_by_id = {result.tool_call_id: result for result in results}
        return [results_by_id[item.tool_call_id] for item in group.items if item.tool_call_id in results_by_id]

    async def _validate_read_timeline_event(self, args, ctx):
        try:
            event_id = to_uuid(args.get("id"), "id")
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_event",
                object_id=event_id,
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_read_timeline_event", str(exc))

    async def _execute_read_timeline_event(self, args, ctx):
        event_id = to_uuid(args.get("id"), "id")
        event = _timeline_event_projection(
            ctx.db,
            project_id=ctx.project_id,
            event_id=event_id,
            language=ctx.language,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result("Read successful", object_id=str(event_id), object_type="timeline_event", data={"object": event}),
        )

    async def _validate_read_timeline_track(self, args, ctx):
        try:
            track_id = to_uuid(args.get("id"), "id")
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_track",
                object_id=track_id,
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_read_timeline_track", str(exc))

    async def _execute_read_timeline_track(self, args, ctx):
        track_id = to_uuid(args.get("id"), "id")
        track = _timeline_track_projection(
            ctx.db,
            project_id=ctx.project_id,
            track_id=track_id,
            language=ctx.language,
        )
        return ToolExecutionOutcome(
            lifecycle="applied",
            result=make_result(
                "Read successful",
                object_id=str(track_id),
                object_type="timeline_track",
                data={"object": track},
            ),
        )

    @staticmethod
    def _clean_optional_id(value) -> str | None:
        return _clean_optional_id(value)

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
        try:
            track_id = to_uuid(args.get("trackId"), "trackId")
            if not str(args.get("name") or "").strip():
                raise ValueError("name is required")
            if not isinstance(args.get("startDate"), dict):
                raise ValueError("startDate must be an object")
            if "endDate" in args and args.get("endDate") is not None and not isinstance(args.get("endDate"), dict):
                raise ValueError("endDate must be an object or null")
            calendar = _calendar_for_track_id(ctx.db, project_id=ctx.project_id, track_id=track_id)
            _validate_tool_event_dates(
                calendar=calendar,
                start_date=args.get("startDate"),
                end_date=args.get("endDate"),
                validate_start=True,
                validate_end="endDate" in args,
            )
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

    async def _validate_replace_timeline_track(self, args, ctx):
        try:
            track_id = to_uuid(args.get("id"), "id")
            if not _has_any_track_replace_field(args):
                raise ValueError("replace_timeline_track requires at least one of name, description, content, parentId, position, or color")
            _non_negative_position(args.get("position"))
            parent_id = None
            if "parentId" in args:
                pid = self._clean_optional_id(args.get("parentId"))
                parent_id = to_uuid(pid, "parentId") if pid else None
                if hasattr(ctx.db, "query"):
                    _validate_track_parent(
                        ctx.db,
                        project_id=ctx.project_id,
                        track_id=track_id,
                        parent_id=parent_id,
                    )
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_track",
                object_id=track_id,
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_replace_timeline_track", str(exc))

    async def _validate_patch_timeline_track(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description", "content"}:
                raise ValueError("field must be one of name|description|content")
            track_id = to_uuid(args.get("id"), "id")
            _non_negative_position(args.get("position"))
            if "parentId" in args:
                pid = self._clean_optional_id(args.get("parentId"))
                parent_id = to_uuid(pid, "parentId") if pid else None
                if hasattr(ctx.db, "query"):
                    _validate_track_parent(
                        ctx.db,
                        project_id=ctx.project_id,
                        track_id=track_id,
                        parent_id=parent_id,
                    )
            current = read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_track",
                object_id=track_id,
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
            return invalid_result("validate_patch_timeline_track", str(exc))

    async def _validate_replace_timeline_event(self, args, ctx):
        try:
            event_id = to_uuid(args.get("id"), "id")
            if not _has_any_event_replace_field(args):
                raise ValueError("replace_timeline_event requires at least one of trackId, name, description, content, startDate, endDate, or tags")
            _validate_event_metadata_args(args, ctx, event_id=event_id)
            read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_event",
                object_id=event_id,
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_replace_timeline_event", str(exc))

    async def _validate_patch_timeline_event(self, args, ctx):
        try:
            field = args.get("field")
            if field not in {"name", "description", "content"}:
                raise ValueError("field must be one of name|description|content")
            event_id = to_uuid(args.get("id"), "id")
            _validate_event_metadata_args(args, ctx, event_id=event_id)
            current = read_runtime_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="timeline_event",
                object_id=event_id,
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
            return invalid_result("validate_patch_timeline_event", str(exc))

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

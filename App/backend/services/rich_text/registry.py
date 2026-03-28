from __future__ import annotations

RICH_TEXT_FIELDS: dict[str, tuple[str, ...]] = {
    "guidelines": ("authorNote",),
    "story_entity": ("content",),
    "outline": ("content",),
    "manuscript": ("content",),
    "timeline_track": ("content",),
    "timeline_event": ("content",),
}


def get_rich_text_fields(object_type: str) -> tuple[str, ...]:
    return RICH_TEXT_FIELDS.get(str(object_type or "").strip(), ())


def is_rich_text_field(object_type: str, field_name: str) -> bool:
    return field_name in get_rich_text_fields(object_type)

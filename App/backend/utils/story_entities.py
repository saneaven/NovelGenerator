"""Shared constants and helpers for canonical story entities."""

from __future__ import annotations

from typing import Iterable


STORY_ENTITY_TYPE = "story_entity"
STORY_ENTITY_KINDS = ("character", "organization", "location", "lorebook")
STORY_ENTITY_KIND_SET = set(STORY_ENTITY_KINDS)
STORY_ENTITY_KIND_ORDER = {
    "character": 0,
    "organization": 1,
    "location": 2,
    "lorebook": 3,
}


def is_story_entity_kind(value: object) -> bool:
    return isinstance(value, str) and value in STORY_ENTITY_KIND_SET


def require_story_entity_kind(value: object) -> str:
    if not is_story_entity_kind(value):
        raise ValueError(f"Unknown story entity kind: {value}")
    return str(value)


def filter_story_entity_kinds(values: Iterable[object]) -> list[str]:
    return [str(value) for value in values if is_story_entity_kind(value)]

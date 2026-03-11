from __future__ import annotations

from typing import Any


def normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def normalize_basic_info_data(data: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(data)
    normalized["title"] = str(data.get("title") or "")
    normalized["logline"] = str(data.get("logline") or "")
    normalized["genres"] = normalize_string_list(data.get("genres"))
    normalized["tags"] = normalize_string_list(data.get("tags"))
    return normalized


def join_string_list(value: Any, *, separator: str = ", ") -> str:
    return separator.join(normalize_string_list(value))


def basic_info_summary_text(data: dict[str, Any]) -> str:
    genres = join_string_list(data.get("genres"))
    tags = join_string_list(data.get("tags"))
    lines = [
        f"Genres: {genres}",
        f"Tags: {tags}",
    ]
    return "\n".join(lines).strip()

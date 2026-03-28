from __future__ import annotations

from typing import Any, Dict

from .basic_info_utils import join_string_list
from .rich_text import get_rich_text_fields, tree_to_text


def safe_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def extract_index_text(object_type: str, version_data: Dict[str, Any], language: str) -> Dict[str, str]:
    """Return indexable text fields for a unified object in the given language.

    Index policy:
    - Only indexes `language` (main_language) content.
    - Excludes images/tables/code blocks.
    """
    lang_blob = version_data.get(language)
    if not isinstance(lang_blob, dict):
        return {}

    rich_fields = get_rich_text_fields(object_type)
    if rich_fields:
        out: Dict[str, str] = {}
        if object_type in {"story_entity", "outline"}:
            name = safe_str(lang_blob.get("name", "")).strip()
            description = safe_str(lang_blob.get("description", "")).strip()
            if name:
                out["name"] = name
            if description:
                out["description"] = description
        for field_name in rich_fields:
            tree = lang_blob.get(field_name)
            if isinstance(tree, dict):
                extracted = tree_to_text(tree).strip()
                if extracted:
                    out[field_name] = extracted
        return out

    if object_type == "basic_info":
        title = safe_str(lang_blob.get("title", "")).strip()
        logline = safe_str(lang_blob.get("logline", "")).strip()
        genres = join_string_list(lang_blob.get("genres"))
        tags = join_string_list(lang_blob.get("tags"))
        content = "\n".join([f"Title: {title}", f"Logline: {logline}", f"Genres: {genres}", f"Tags: {tags}"]).strip()
        return {"content": content} if content else {}

    name = safe_str(lang_blob.get("name", ""))
    description = safe_str(lang_blob.get("description", ""))
    content = safe_str(lang_blob.get("content", ""))

    return {
        "name": name.strip(),
        "description": description.strip(),
        "content": content.strip(),
    }

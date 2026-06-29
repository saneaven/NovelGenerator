from __future__ import annotations

from typing import Any


def _clean_language(value: Any) -> str:
    return str(value or "").strip()


def language_enum_for_settings(settings: Any) -> list[str]:
    languages: list[str] = []

    main_language = _clean_language(getattr(settings, "main_language", None))
    if main_language:
        languages.append(main_language)

    sub_languages = getattr(settings, "sub_languages", None)
    if isinstance(sub_languages, list):
        for value in sub_languages:
            language = _clean_language(value)
            if language and language not in languages:
                languages.append(language)

    return languages or ["English"]


def target_language_schema(settings: Any) -> dict[str, Any]:
    return {"type": "string", "enum": language_enum_for_settings(settings)}


def translation_target_language(args: dict[str, Any], settings: Any) -> str:
    language = _clean_language(args.get("targetLanguage"))
    if not language:
        raise ValueError("targetLanguage is required for translation tools")

    allowed = language_enum_for_settings(settings)
    if language not in allowed:
        raise ValueError(f"Invalid targetLanguage: {language}")

    return language


def _meta_value(binding_or_meta: Any, key: str) -> Any:
    meta = getattr(binding_or_meta, "meta", binding_or_meta)
    if isinstance(meta, dict):
        return meta.get(key)
    return getattr(meta, key, None)


def tool_language_for_args(
    binding_or_meta: Any,
    args: dict[str, Any],
    run_language: str,
    settings: Any,
) -> str:
    category = _meta_value(binding_or_meta, "category")
    op = _meta_value(binding_or_meta, "op")
    if category == "translate" or op in {"translate", "patch_translation"}:
        return translation_target_language(args, settings)
    return _clean_language(run_language) or language_enum_for_settings(settings)[0]

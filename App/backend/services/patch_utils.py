from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
import json
import re
import unicodedata


_WS_RE = re.compile(r"[\u00A0\u2000-\u200A\u202F\u205F\u3000]")
_ZERO_WIDTH_RE = re.compile(r"[\u200B-\u200D\uFEFF]")
_SINGLE_QUOTES_RE = re.compile(r"[\u2018\u2019\u201A\u201B]")
_DOUBLE_QUOTES_RE = re.compile(r"[\u201C\u201D\u201E\u201F]")
_DASH_RE = re.compile(r"[\u2013\u2014]")
_SENTENCE_RE = re.compile(r"[^.!?。！？\n]+(?:[.!?。！？]+|$)")
_CLAUSE_RE = re.compile(r"[^,;:，、；：.!?。！？\n]+")
_WORD_RE = re.compile(r"\S+")

_MAX_REASON_VALUE_CHARS = 160
_MAX_REASON_CHARS = 500
_MAX_SEQUENCE_UNITS = 2000
_MAX_FALLBACK_UNITS = 350
_MAX_ANCHOR_OCCURRENCES = 5


@dataclass(frozen=True)
class _NaturalUnit:
    text: str
    start: int
    end: int


@dataclass
class ReplacementResult:
    success: bool
    content: str
    code: str | None = None
    reason: str | None = None


def normalize_text(text: str) -> str:
    if text is None:
        return ""
    out = text.replace("\r\n", "\n").replace("\r", "\n")
    out = _WS_RE.sub(" ", out)
    out = _ZERO_WIDTH_RE.sub("", out)
    out = _SINGLE_QUOTES_RE.sub("'", out)
    out = _DOUBLE_QUOTES_RE.sub('"', out)
    out = _DASH_RE.sub("-", out)
    out = unicodedata.normalize("NFC", out)
    return out


def _trim_unit(text: str, start: int, end: int) -> _NaturalUnit | None:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    if start >= end:
        return None
    unit_text = text[start:end]
    if not any(ch.isalnum() for ch in unit_text):
        return None
    return _NaturalUnit(text=unit_text, start=start, end=end)


def _split_on_blank_lines(text: str) -> list[_NaturalUnit]:
    units: list[_NaturalUnit] = []
    start = 0
    for match in re.finditer(r"\n\s*\n", text):
        unit = _trim_unit(text, start, match.start())
        if unit is not None:
            units.append(unit)
        start = match.end()
    unit = _trim_unit(text, start, len(text))
    if unit is not None:
        units.append(unit)
    return units


def _split_lines(text: str) -> list[_NaturalUnit]:
    units: list[_NaturalUnit] = []
    start = 0
    for line in text.splitlines(keepends=True):
        end = start + len(line)
        unit = _trim_unit(text, start, end)
        if unit is not None:
            units.append(unit)
        start = end
    if not text.endswith("\n") and start < len(text):
        unit = _trim_unit(text, start, len(text))
        if unit is not None and (not units or unit.start != units[-1].start):
            units.append(unit)
    return units


def _regex_units(text: str, pattern: re.Pattern[str]) -> list[_NaturalUnit]:
    units: list[_NaturalUnit] = []
    for match in pattern.finditer(text):
        unit = _trim_unit(text, match.start(), match.end())
        if unit is not None:
            units.append(unit)
    return units


def _word_group_units(text: str) -> list[_NaturalUnit]:
    words = list(_WORD_RE.finditer(text))
    if len(words) < 2:
        return []
    units: list[_NaturalUnit] = []
    max_size = min(4, len(words))
    for size in range(max_size, 1, -1):
        for index in range(0, len(words) - size + 1):
            start = words[index].start()
            end = words[index + size - 1].end()
            unit = _trim_unit(text, start, end)
            if unit is not None:
                units.append(unit)
    return units


def _units_by_natural_level(text: str) -> list[list[_NaturalUnit]]:
    return [
        _regex_units(text, _SENTENCE_RE),
        _regex_units(text, _CLAUSE_RE),
        _split_lines(text),
        _split_on_blank_lines(text),
        _word_group_units(text),
    ]


def _preview(value: str) -> str | None:
    value = value.strip()
    if not value:
        return ""
    if len(value) > _MAX_REASON_VALUE_CHARS:
        return None
    return value


def _format_expected_actual_reason(expected: str, actual: str) -> str | None:
    expected_preview = _preview(expected)
    actual_preview = _preview(actual)
    if expected_preview is None or actual_preview is None:
        return None
    reason = (
        "PATCH_NOT_FOUND\n"
        f"expected={json.dumps(expected_preview, ensure_ascii=False)}\n"
        f"actual={json.dumps(actual_preview, ensure_ascii=False)}"
    )
    if len(reason) > _MAX_REASON_CHARS:
        return None
    return reason


def _count_occurrences(text: str, needle: str, *, limit: int = 100) -> int:
    if not needle:
        return 0
    count = 0
    start = 0
    while count < limit:
        index = text.find(needle, start)
        if index == -1:
            return count
        count += 1
        start = index + 1
    return count


def _find_sequence_mismatch(old: str, content: str) -> tuple[str, str] | None:
    old_levels = _units_by_natural_level(old)
    content_levels = _units_by_natural_level(content)
    for level_index, old_units in enumerate(old_levels):
        if not old_units or len(old_units) > _MAX_SEQUENCE_UNITS:
            continue
        content_units = content_levels[level_index]
        if not content_units or len(content_units) > _MAX_SEQUENCE_UNITS:
            continue

        old_texts = [unit.text for unit in old_units]
        content_texts = [unit.text for unit in content_units]
        matcher = SequenceMatcher(None, old_texts, content_texts, autojunk=False)
        for tag, old_start, old_end, content_start, content_end in matcher.get_opcodes():
            if tag == "equal":
                continue
            old_count = old_end - old_start
            content_count = content_end - content_start
            if old_count == 1 and content_count == 1:
                expected = old_units[old_start].text
                actual = content_units[content_start].text
                if SequenceMatcher(None, expected, actual, autojunk=False).ratio() < 0.45:
                    continue
                if _format_expected_actual_reason(expected, actual) is not None:
                    return expected, actual
            if old_count == 1 and content_count == 0:
                expected = old_units[old_start].text
                if _format_expected_actual_reason(expected, "") is not None:
                    return expected, ""
    return None


def _ordered_anchor_count(anchors: list[str], actual: str) -> int:
    count = 0
    start = 0
    for anchor in anchors:
        index = actual.find(anchor, start)
        if index == -1:
            continue
        count += 1
        start = index + len(anchor)
    return count


def _anchor_candidates(unit: str, content: str) -> list[str]:
    anchors: list[str] = []
    seen: set[str] = set()
    for candidate in _word_group_units(unit) + _regex_units(unit, _CLAUSE_RE):
        text = candidate.text.strip()
        if len(text) < 4 or text in seen:
            continue
        seen.add(text)
        if _count_occurrences(content, text, limit=_MAX_ANCHOR_OCCURRENCES + 1) > _MAX_ANCHOR_OCCURRENCES:
            continue
        anchors.append(text)
    return anchors


def _find_anchor_mismatch(old: str, content: str) -> tuple[str, str] | None:
    content_levels = _units_by_natural_level(content)
    for level_index, old_units in enumerate(_units_by_natural_level(old)):
        content_units = content_levels[level_index]
        if not old_units or not content_units:
            continue
        old_units = old_units[:_MAX_FALLBACK_UNITS]
        content_units = content_units[:_MAX_FALLBACK_UNITS]

        for old_unit in old_units:
            if content.find(old_unit.text) != -1:
                continue
            expected = old_unit.text
            if _preview(expected) is None:
                continue
            anchors = _anchor_candidates(expected, content)
            if len(anchors) < 2:
                continue

            best: tuple[int, float, str] | None = None
            for content_unit in content_units:
                actual = content_unit.text
                if _preview(actual) is None:
                    continue
                anchor_count = _ordered_anchor_count(anchors, actual)
                if anchor_count < 2:
                    continue
                ratio = SequenceMatcher(None, expected, actual, autojunk=False).ratio()
                if ratio < 0.35:
                    continue
                current = (anchor_count, ratio, actual)
                if best is None or current[:2] > best[:2]:
                    best = current

            if best is not None:
                return expected, best[2]
    return None


def _format_not_found_reason(old: str, content: str) -> str:
    mismatch = _find_sequence_mismatch(old, content) or _find_anchor_mismatch(old, content)
    if mismatch is not None:
        reason = _format_expected_actual_reason(*mismatch)
        if reason is not None:
            return reason
    return "PATCH_NOT_FOUND\nno reliable close match"


def _format_not_unique_reason(match_count: int) -> str:
    return (
        "PATCH_NOT_UNIQUE\n"
        f"matches={match_count}\n"
        "old appears multiple times. Use a longer old string."
    )


def apply_single_replacement(content: str, old_text: str, new_text: str) -> ReplacementResult:
    normalized_content = normalize_text(content)
    normalized_old = normalize_text(old_text)
    normalized_new = normalize_text(new_text)

    if not normalized_old:
        return ReplacementResult(
            success=False,
            content=content,
            code="EMPTY_OLD_TEXT",
            reason="old text must not be empty",
        )

    index = normalized_content.find(normalized_old)
    if index == -1:
        return ReplacementResult(
            success=False,
            content=content,
            code="PATCH_NOT_FOUND",
            reason=_format_not_found_reason(normalized_old, normalized_content),
        )

    second_index = normalized_content.find(normalized_old, index + 1)
    if second_index != -1:
        match_count = _count_occurrences(normalized_content, normalized_old)
        return ReplacementResult(
            success=False,
            content=content,
            code="PATCH_NOT_UNIQUE",
            reason=_format_not_unique_reason(match_count),
        )

    replaced = (
        normalized_content[:index]
        + normalized_new
        + normalized_content[index + len(normalized_old) :]
    )

    return ReplacementResult(success=True, content=replaced)

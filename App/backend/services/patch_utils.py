from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata


_WS_RE = re.compile(r"[\u00A0\u2000-\u200A\u202F\u205F\u3000]")
_ZERO_WIDTH_RE = re.compile(r"[\u200B-\u200D\uFEFF]")
_SINGLE_QUOTES_RE = re.compile(r"[\u2018\u2019\u201A\u201B]")
_DOUBLE_QUOTES_RE = re.compile(r"[\u201C\u201D\u201E\u201F]")
_DASH_RE = re.compile(r"[\u2013\u2014]")


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
            reason=f'Text not found: "{old_text[:50]}{"..." if len(old_text) > 50 else ""}"',
        )

    second_index = normalized_content.find(normalized_old, index + 1)
    if second_index != -1:
        return ReplacementResult(
            success=False,
            content=content,
            code="PATCH_NOT_UNIQUE",
            reason=(
                f'Text appears multiple times: "{old_text[:50]}{"..." if len(old_text) > 50 else ""}" '
                "- include more surrounding context in old"
            ),
        )

    replaced = (
        normalized_content[:index]
        + normalized_new
        + normalized_content[index + len(normalized_old) :]
    )

    return ReplacementResult(success=True, content=replaced)

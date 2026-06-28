from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from xml.sax.saxutils import escape


_WS_RE = re.compile(r"[\u00A0\u2000-\u200A\u202F\u205F\u3000]")
_ZERO_WIDTH_RE = re.compile(r"[\u200B-\u200D\uFEFF]")
_SINGLE_QUOTES_RE = re.compile(r"[\u2018\u2019\u201A\u201B]")
_DOUBLE_QUOTES_RE = re.compile(r"[\u201C\u201D\u201E\u201F]")
_DASH_RE = re.compile(r"[\u2013\u2014]")

_ANCHOR_COUNT = 20
_MAX_MISMATCH_RECURSION_DEPTH = 4
_CONTEXT_CHARS = 24


@dataclass
class ReplacementResult:
    success: bool
    content: str
    code: str | None = None
    reason: str | None = None


@dataclass(frozen=True)
class _Anchor:
    text: str
    start: int
    end: int


@dataclass(frozen=True)
class _AnchorMatch:
    anchor: _Anchor
    actual_start: int
    actual_end: int


@dataclass(frozen=True)
class _TargetCandidate:
    actual_start: int
    actual_end: int
    matches: tuple[_AnchorMatch, ...]


@dataclass(frozen=True)
class _MismatchBlock:
    expected: str
    actual: str
    before_context: str
    after_context: str


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


def _xml(value: str) -> str:
    return escape(value, {'"': "&quot;"})


def _tag(name: str, value: str, *, indent: str = "  ") -> str:
    return f"{indent}<{name}>{_xml(value)}</{name}>"


def _format_simple_failure(code: str, kind: str, message: str) -> str:
    return "\n".join(
        [
            f'<patch_failure code="{_xml(code)}" kind="{_xml(kind)}">',
            _tag("message", message),
            "</patch_failure>",
        ]
    )


def _format_mismatch_failure(code: str, kind: str, blocks: list[_MismatchBlock]) -> str:
    lines = [f'<patch_failure code="{_xml(code)}" kind="{_xml(kind)}">', "  <mismatches>"]
    for block in blocks:
        lines.append("    <mismatch>")
        lines.append(_tag("before_context", block.before_context, indent="      "))
        lines.append(_tag("expected_block", block.expected, indent="      "))
        lines.append(_tag("actual_block", block.actual, indent="      "))
        lines.append(_tag("after_context", block.after_context, indent="      "))
        lines.append("    </mismatch>")
    lines.extend(["  </mismatches>", "</patch_failure>"])
    return "\n".join(lines)


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


def _trim_anchor(text: str, start: int, end: int) -> _Anchor | None:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    if start >= end:
        return None
    return _Anchor(text=text[start:end], start=start, end=end)


def _make_anchors(text: str) -> list[_Anchor]:
    if not text:
        return []

    count = min(_ANCHOR_COUNT, len(text))
    anchors: list[_Anchor] = []
    for index in range(count):
        start = (len(text) * index) // count
        end = (len(text) * (index + 1)) // count
        anchor = _trim_anchor(text, start, end)
        if anchor is not None:
            anchors.append(anchor)
    return anchors


def _find_occurrences(text: str, needle: str) -> list[int]:
    if not needle:
        return []
    out: list[int] = []
    start = 0
    while start <= len(text):
        index = text.find(needle, start)
        if index == -1:
            break
        out.append(index)
        start = index + 1
    return out


def _minimum_chain_length(anchor_count: int) -> int:
    if anchor_count <= 1:
        return anchor_count
    return min(anchor_count, max(2, anchor_count // 3))


def _chain_from_seed(
    *,
    anchors: list[_Anchor],
    occurrences_by_index: dict[int, list[int]],
    seed_anchor_index: int,
    seed_actual_start: int,
) -> tuple[_AnchorMatch, ...]:
    seed_anchor = anchors[seed_anchor_index]
    seed = _AnchorMatch(
        anchor=seed_anchor,
        actual_start=seed_actual_start,
        actual_end=seed_actual_start + len(seed_anchor.text),
    )

    before: list[_AnchorMatch] = []
    next_actual_start = seed.actual_start
    for anchor_index in range(seed_anchor_index - 1, -1, -1):
        anchor = anchors[anchor_index]
        occurrence = None
        for candidate_start in occurrences_by_index.get(anchor_index, []):
            candidate_end = candidate_start + len(anchor.text)
            if candidate_end <= next_actual_start:
                occurrence = candidate_start
            else:
                break
        if occurrence is None:
            continue
        match = _AnchorMatch(
            anchor=anchor,
            actual_start=occurrence,
            actual_end=occurrence + len(anchor.text),
        )
        before.append(match)
        next_actual_start = match.actual_start

    after: list[_AnchorMatch] = []
    next_actual_end = seed.actual_end
    for anchor_index in range(seed_anchor_index + 1, len(anchors)):
        anchor = anchors[anchor_index]
        occurrence = None
        for candidate_start in occurrences_by_index.get(anchor_index, []):
            if candidate_start >= next_actual_end:
                occurrence = candidate_start
                break
        if occurrence is None:
            continue
        match = _AnchorMatch(
            anchor=anchor,
            actual_start=occurrence,
            actual_end=occurrence + len(anchor.text),
        )
        after.append(match)
        next_actual_end = match.actual_end

    return tuple(reversed(before)) + (seed,) + tuple(after)


def _candidate_from_chain(chain: tuple[_AnchorMatch, ...], old_length: int, actual_length: int) -> _TargetCandidate | None:
    if not chain:
        return None
    actual_start = chain[0].actual_start - chain[0].anchor.start
    actual_end = chain[-1].actual_end + (old_length - chain[-1].anchor.end)
    actual_start = max(0, actual_start)
    actual_end = min(actual_length, actual_end)
    if actual_start > actual_end:
        return None
    return _TargetCandidate(actual_start=actual_start, actual_end=actual_end, matches=chain)


def _find_target_candidates(old: str, actual: str) -> list[_TargetCandidate]:
    anchors = _make_anchors(old)
    if not anchors:
        return []

    occurrences_by_index: dict[int, list[int]] = {
        index: _find_occurrences(actual, anchor.text)
        for index, anchor in enumerate(anchors)
    }
    min_chain_length = _minimum_chain_length(len(anchors))
    candidates_by_range: dict[tuple[int, int], _TargetCandidate] = {}

    for anchor_index, occurrences in occurrences_by_index.items():
        for occurrence in occurrences:
            chain = _chain_from_seed(
                anchors=anchors,
                occurrences_by_index=occurrences_by_index,
                seed_anchor_index=anchor_index,
                seed_actual_start=occurrence,
            )
            if len(chain) < min_chain_length:
                continue
            candidate = _candidate_from_chain(chain, len(old), len(actual))
            if candidate is None:
                continue
            key = (candidate.actual_start, candidate.actual_end)
            existing = candidates_by_range.get(key)
            if existing is None or len(candidate.matches) > len(existing.matches):
                candidates_by_range[key] = candidate

    if not candidates_by_range:
        return []

    best_match_count = max(len(candidate.matches) for candidate in candidates_by_range.values())
    return [
        candidate
        for candidate in candidates_by_range.values()
        if len(candidate.matches) == best_match_count
    ]


def _find_split_chain(old: str, actual: str) -> tuple[_AnchorMatch, ...]:
    anchors = _make_anchors(old)
    if not anchors:
        return ()

    occurrences_by_index: dict[int, list[int]] = {
        index: _find_occurrences(actual, anchor.text)
        for index, anchor in enumerate(anchors)
    }
    chains: dict[tuple[tuple[int, int, int], ...], tuple[_AnchorMatch, ...]] = {}
    for anchor_index, occurrences in occurrences_by_index.items():
        for occurrence in occurrences:
            chain = _chain_from_seed(
                anchors=anchors,
                occurrences_by_index=occurrences_by_index,
                seed_anchor_index=anchor_index,
                seed_actual_start=occurrence,
            )
            if not chain:
                continue
            key = tuple((match.anchor.start, match.actual_start, match.actual_end) for match in chain)
            chains[key] = chain

    if not chains:
        return ()
    best_count = max(len(chain) for chain in chains.values())
    best_chains = [chain for chain in chains.values() if len(chain) == best_count]
    if len(best_chains) != 1:
        return ()
    return best_chains[0]


def _context(source: str, start: int, end: int) -> tuple[str, str]:
    before = source[max(0, start - _CONTEXT_CHARS) : start]
    after = source[end : min(len(source), end + _CONTEXT_CHARS)]
    return before, after


def _trim_mismatch_edges(
    old: str,
    actual: str,
    old_start: int,
    old_end: int,
    actual_start: int,
    actual_end: int,
) -> tuple[int, int, int, int]:
    while old_start < old_end and actual_start < actual_end and old[old_start] == actual[actual_start]:
        old_start += 1
        actual_start += 1
    while old_start < old_end and actual_start < actual_end and old[old_end - 1] == actual[actual_end - 1]:
        old_end -= 1
        actual_end -= 1
    return old_start, old_end, actual_start, actual_end


def _block(old: str, actual: str, old_start: int, old_end: int, actual_start: int, actual_end: int) -> _MismatchBlock:
    old_start, old_end, actual_start, actual_end = _trim_mismatch_edges(
        old,
        actual,
        old_start,
        old_end,
        actual_start,
        actual_end,
    )
    before, after = _context(old, old_start, old_end)
    if not before and actual_start > 0:
        before = actual[max(0, actual_start - _CONTEXT_CHARS) : actual_start]
    if not after and actual_end < len(actual):
        after = actual[actual_end : min(len(actual), actual_end + _CONTEXT_CHARS)]
    return _MismatchBlock(
        expected=old[old_start:old_end],
        actual=actual[actual_start:actual_end],
        before_context=before,
        after_context=after,
    )


def _split_mismatches(
    old: str,
    actual: str,
    *,
    depth: int = 0,
    old_offset: int = 0,
    actual_offset: int = 0,
    root_old: str | None = None,
    root_actual: str | None = None,
) -> list[_MismatchBlock]:
    root_old = old if root_old is None else root_old
    root_actual = actual if root_actual is None else root_actual
    if old == actual:
        return []
    if depth >= _MAX_MISMATCH_RECURSION_DEPTH:
        return [
            _block(
                root_old,
                root_actual,
                old_offset,
                old_offset + len(old),
                actual_offset,
                actual_offset + len(actual),
            )
        ]

    chain = _find_split_chain(old, actual)
    if not chain:
        return [
            _block(
                root_old,
                root_actual,
                old_offset,
                old_offset + len(old),
                actual_offset,
                actual_offset + len(actual),
            )
        ]

    out: list[_MismatchBlock] = []
    old_cursor = 0
    actual_cursor = 0
    made_progress = False
    for match in chain:
        if match.anchor.start > old_cursor or match.actual_start > actual_cursor:
            out.extend(
                _split_mismatches(
                    old[old_cursor : match.anchor.start],
                    actual[actual_cursor : match.actual_start],
                    depth=depth + 1,
                    old_offset=old_offset + old_cursor,
                    actual_offset=actual_offset + actual_cursor,
                    root_old=root_old,
                    root_actual=root_actual,
                )
            )
            made_progress = True
        old_cursor = match.anchor.end
        actual_cursor = match.actual_end

    if old_cursor < len(old) or actual_cursor < len(actual):
        out.extend(
            _split_mismatches(
                old[old_cursor:],
                actual[actual_cursor:],
                depth=depth + 1,
                old_offset=old_offset + old_cursor,
                actual_offset=actual_offset + actual_cursor,
                root_old=root_old,
                root_actual=root_actual,
            )
        )
        made_progress = True

    if not made_progress:
        return [
            _block(
                root_old,
                root_actual,
                old_offset,
                old_offset + len(old),
                actual_offset,
                actual_offset + len(actual),
            )
        ]
    return out


def _format_not_found_reason(old: str, content: str) -> str:
    candidates = _find_target_candidates(old, content)
    if not candidates:
        return _format_simple_failure(
            "PATCH_NOT_FOUND",
            "target_not_found",
            "old text was not found in the current content.",
        )
    if len(candidates) > 1:
        return _format_simple_failure(
            "PATCH_NOT_FOUND",
            "target_ambiguous",
            "multiple possible target regions matched the anchors.",
        )

    candidate = candidates[0]
    actual = content[candidate.actual_start : candidate.actual_end]
    blocks = _split_mismatches(old, actual)
    if not blocks:
        return _format_simple_failure(
            "PATCH_NOT_FOUND",
            "target_not_found",
            "old text was not found in the current content.",
        )
    return _format_mismatch_failure("PATCH_NOT_FOUND", "target_mismatch", blocks)


def _format_not_unique_reason() -> str:
    return _format_simple_failure(
        "PATCH_NOT_UNIQUE",
        "target_ambiguous",
        "old text appears multiple times. Use a longer old string.",
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
            reason=_format_simple_failure(
                "EMPTY_OLD_TEXT",
                "empty_old_text",
                "old text must not be empty.",
            ),
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
        return ReplacementResult(
            success=False,
            content=content,
            code="PATCH_NOT_UNIQUE",
            reason=_format_not_unique_reason(),
        )

    replaced = (
        normalized_content[:index]
        + normalized_new
        + normalized_content[index + len(normalized_old) :]
    )

    return ReplacementResult(success=True, content=replaced)

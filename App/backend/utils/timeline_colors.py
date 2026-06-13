"""Automatic OKLCH color assignment for timeline tracks.

Tracks store a canonical oklch string: ``oklch(0.680 0.140 250.0)``.
Root tracks get a fixed lightness/chroma with hues spread apart by bisecting
the largest unused gap on the hue wheel; child tracks derive from their
parent's color, spread within ±CHILD_HUE_MAX° of the parent hue by bisecting
the largest unused gap in that band, with progressively darker lightness.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any, Iterable

ROOT_L = 0.68
ROOT_C = 0.14
SEED_HUE = 250.0

CHILD_L_STEP = 0.06
MIN_L = 0.40
CHILD_C_STEP = 0.015
MIN_C = 0.08
CHILD_HUE_MAX = 30.0  # children stay within ±this many degrees of the parent hue

# Hues of near-neutral colors are meaningless; don't let them constrain placement.
_NEUTRAL_CHROMA_CUTOFF = 0.04

_OKLCH_RE = re.compile(
    r"^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?\s*(?:/\s*[0-9.]+%?\s*)?\)$",
    re.IGNORECASE,
)

_HEX_RE = re.compile(r"^#(?:[0-9a-f]{3}|[0-9a-f]{6})$", re.IGNORECASE)


def parse_oklch(value: str) -> tuple[float, float, float] | None:
    match = _OKLCH_RE.match(value.strip())
    if match is None:
        return None
    raw_l, raw_c, raw_h = match.groups()
    try:
        l = float(raw_l[:-1]) / 100.0 if raw_l.endswith("%") else float(raw_l)
        c = float(raw_c)
        h = float(raw_h)
    except ValueError:
        return None
    return (min(max(l, 0.0), 1.0), max(c, 0.0), h % 360.0)


def format_oklch(l: float, c: float, h: float) -> str:
    l = min(max(l, 0.0), 1.0)
    c = max(c, 0.0)
    h = round(h % 360.0, 1) % 360.0
    return f"oklch({l:.3f} {c:.3f} {h:.1f})"


def _srgb_to_linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(channel: float) -> float:
    channel = min(max(channel, 0.0), 1.0)
    return channel * 12.92 if channel <= 0.0031308 else 1.055 * channel ** (1 / 2.4) - 0.055


def hex_to_oklch(value: str) -> str | None:
    text = value.strip()
    if not _HEX_RE.match(text):
        return None
    digits = text[1:]
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    r, g, b = (
        _srgb_to_linear(int(digits[i : i + 2], 16) / 255.0) for i in (0, 2, 4)
    )

    lin_l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    lin_m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    lin_s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (v ** (1 / 3) if v > 0 else 0.0 for v in (lin_l, lin_m, lin_s))

    okl = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    oka = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    okb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_

    chroma = math.hypot(oka, okb)
    hue = math.degrees(math.atan2(okb, oka)) % 360.0 if chroma > 1e-6 else 0.0
    return format_oklch(okl, chroma, hue)


def oklch_to_hex(l: float, c: float, h: float) -> str:
    rad = math.radians(h)
    oka = c * math.cos(rad)
    okb = c * math.sin(rad)

    l_ = l + 0.3963377774 * oka + 0.2158037573 * okb
    m_ = l - 0.1055613458 * oka - 0.0638541728 * okb
    s_ = l - 0.0894841775 * oka - 1.2914855480 * okb
    lin_l, lin_m, lin_s = (v ** 3 for v in (l_, m_, s_))

    r = 4.0767416621 * lin_l - 3.3077115913 * lin_m + 0.2309699292 * lin_s
    g = -1.2684380046 * lin_l + 2.6097574011 * lin_m - 0.3413193965 * lin_s
    b = -0.0041960863 * lin_l - 0.7034186147 * lin_m + 1.7076147010 * lin_s

    return "#" + "".join(f"{round(_linear_to_srgb(ch) * 255):02x}" for ch in (r, g, b))


def normalize_track_color(value: Any) -> str | None:
    """Coerce an incoming color to the canonical oklch string, or None.

    Accepts canonical/loose oklch strings and #hex from the free color picker.
    Invalid input yields None so callers treat it as "auto" on create and as a
    no-op on update (LLM tool calls must not hard-fail).
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    parsed = parse_oklch(text)
    if parsed is not None:
        return format_oklch(*parsed)
    if text.startswith("#"):
        return hex_to_oklch(text)
    return None


def next_root_hue(existing_hues: Iterable[float]) -> float:
    hues = sorted({h % 360.0 for h in existing_hues})
    if not hues:
        return SEED_HUE
    if len(hues) == 1:
        return (hues[0] + 180.0) % 360.0
    best_gap = -1.0
    best_start = hues[0]
    for i, hue in enumerate(hues):
        gap = (hues[(i + 1) % len(hues)] - hue) % 360.0
        if gap > best_gap:
            best_gap = gap
            best_start = hue
    return (best_start + best_gap / 2.0) % 360.0


def next_child_hue(parent_hue: float, sibling_offsets: Iterable[float]) -> float:
    """Place a child within ±CHILD_HUE_MAX° of the parent by farthest-point insertion.

    ``sibling_offsets`` are the existing siblings' hues expressed as signed
    degrees from the parent hue; they are clamped to the band. The new child
    lands at whichever candidate (a band endpoint, or the midpoint of a gap
    between adjacent siblings) sits farthest from every existing sibling — the
    linear, bounded analogue of :func:`next_root_hue`. The first child seeds at
    the +CHILD_HUE_MAX° edge. Ties prefer the endpoints (+ before −), then
    midpoints left→right, taking the first maximum so results are deterministic.
    """
    span = CHILD_HUE_MAX
    offsets = sorted({min(max(o, -span), span) for o in sibling_offsets})
    if not offsets:
        return (parent_hue + span) % 360.0
    best_offset = span
    best_dist = -1.0
    for candidate in (span, -span):
        dist = min(abs(candidate - o) for o in offsets)
        if dist > best_dist:
            best_dist = dist
            best_offset = candidate
    for left, right in zip(offsets, offsets[1:]):
        dist = (right - left) / 2.0
        if dist > best_dist:
            best_dist = dist
            best_offset = (left + right) / 2.0
    return (parent_hue + best_offset) % 360.0


def _chromatic_hues(colors: Iterable[Any]) -> list[float]:
    hues: list[float] = []
    for color in colors:
        normalized = normalize_track_color(color)
        if normalized is None:
            continue
        parsed = parse_oklch(normalized)
        if parsed is not None and parsed[1] >= _NEUTRAL_CHROMA_CUTOFF:
            hues.append(parsed[2])
    return hues


def root_track_color(existing_colors: Iterable[Any]) -> str:
    return format_oklch(ROOT_L, ROOT_C, next_root_hue(_chromatic_hues(existing_colors)))


def child_track_color(parent_color: Any, sibling_colors: Iterable[Any]) -> str:
    normalized = normalize_track_color(parent_color)
    parsed = parse_oklch(normalized) if normalized is not None else None
    if parsed is None:
        return format_oklch(ROOT_L, ROOT_C, SEED_HUE)
    l, c, h = parsed
    offsets: list[float] = []
    for sibling in sibling_colors:
        sibling_norm = normalize_track_color(sibling)
        sibling_parsed = parse_oklch(sibling_norm) if sibling_norm is not None else None
        if sibling_parsed is None:
            continue
        offsets.append(((sibling_parsed[2] - h + 180.0) % 360.0) - 180.0)
    return format_oklch(
        max(l - CHILD_L_STEP, MIN_L),
        max(c - CHILD_C_STEP, min(c, MIN_C)),
        next_child_hue(h, offsets),
    )


def backfill_missing_colors(
    rows: Iterable[tuple[Any, Any, int, Any]],
) -> dict[Any, str]:
    """Assign colors across one timeline's track tree without repainting.

    ``rows`` are ``(id, parent_id, position, color)`` tuples. Tracks that
    already carry a valid oklch color keep it; only missing/invalid colors are
    assigned — roots avoid hues already in use, children derive from their
    parent's effective color. Returns ``{id: color}`` for rows whose stored
    value must change.
    """
    items = list(rows)
    children: dict[Any, list[tuple[Any, Any, int, Any]]] = defaultdict(list)
    for item in items:
        children[item[1]].append(item)
    for siblings in children.values():
        siblings.sort(key=lambda item: item[2])

    changes: dict[Any, str] = {}
    effective: dict[Any, str] = {}

    roots = children.get(None, [])
    decided = [
        color for color in (normalize_track_color(item[3]) for item in roots) if color
    ]
    for row_id, _parent, _position, color in roots:
        normalized = normalize_track_color(color)
        if normalized is None:
            normalized = root_track_color(decided)
            decided.append(normalized)
        effective[row_id] = normalized
        if normalized != color:
            changes[row_id] = normalized

    def walk(parent_id: Any) -> None:
        siblings = children.get(parent_id, [])
        if parent_id is not None:
            # Pass 1: keep valid sibling colors so missing ones avoid their hues.
            for row_id, _parent, _position, color in siblings:
                normalized = normalize_track_color(color)
                if normalized is not None:
                    effective[row_id] = normalized
                    if normalized != color:
                        changes[row_id] = normalized
            # Pass 2: place each missing sibling in the largest gap of the band.
            for row_id, _parent, _position, color in siblings:
                if row_id in effective:
                    continue
                placed = [effective[s[0]] for s in siblings if s[0] in effective]
                normalized = child_track_color(effective.get(parent_id), placed)
                effective[row_id] = normalized
                changes[row_id] = normalized
        for row_id, _parent, _position, _color in siblings:
            walk(row_id)

    walk(None)

    # Orphans (parent_id not among rows) never get walked; still guarantee a color.
    for row_id, _parent, _position, color in items:
        if row_id in effective:
            continue
        normalized = normalize_track_color(color) or format_oklch(ROOT_L, ROOT_C, SEED_HUE)
        effective[row_id] = normalized
        if normalized != color:
            changes[row_id] = normalized

    return changes

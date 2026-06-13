"""Timeline track colors: repaint the whole tree with ±25° gap spread.

Migration 0024 colored children with a fixed alternating fan capped at ±25°,
which saturates: from the 7th sibling on every child collapses onto +25° or
−25°, so deep sibling groups cluster into two hues. This migration recolors
*every* track from scratch with the current algorithm — roots bisect the
largest gap on the full hue wheel, children bisect the largest gap within
±CHILD_HUE_MAX° of their parent (farthest-point, no duplicates).

Existing colors (including any manually picked ones) are discarded; this is a
deliberate full repaint. Color helpers are self-contained copies of
App/backend/utils/timeline_colors.py (migrations must not import app code).
"""

from __future__ import annotations

import re
from collections import defaultdict

import sqlalchemy as sa
from alembic import op


revision = "0025_timeline_color_spread"
down_revision = "0024_timeline_track_color"
branch_labels = None
depends_on = None


ROOT_L = 0.68
ROOT_C = 0.14
SEED_HUE = 250.0
CHILD_L_STEP = 0.06
MIN_L = 0.40
CHILD_C_STEP = 0.015
MIN_C = 0.08
CHILD_HUE_MAX = 25.0
_NEUTRAL_CHROMA_CUTOFF = 0.04

_OKLCH_RE = re.compile(
    r"^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?\s*(?:/\s*[0-9.]+%?\s*)?\)$",
    re.IGNORECASE,
)


def _parse_oklch(value):
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


def _format_oklch(l, c, h):
    l = min(max(l, 0.0), 1.0)
    c = max(c, 0.0)
    h = round(h % 360.0, 1) % 360.0
    return f"oklch({l:.3f} {c:.3f} {h:.1f})"


def _next_root_hue(existing_hues):
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


def _root_color(existing_colors):
    hues = []
    for color in existing_colors:
        parsed = _parse_oklch(color) if color else None
        if parsed is not None and parsed[1] >= _NEUTRAL_CHROMA_CUTOFF:
            hues.append(parsed[2])
    return _format_oklch(ROOT_L, ROOT_C, _next_root_hue(hues))


def _next_child_hue(parent_hue, sibling_offsets):
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


def _child_color(parent_color, sibling_colors):
    parsed = _parse_oklch(parent_color) if parent_color else None
    if parsed is None:
        return _format_oklch(ROOT_L, ROOT_C, SEED_HUE)
    l, c, h = parsed
    offsets = []
    for sibling in sibling_colors:
        sibling_parsed = _parse_oklch(sibling) if sibling else None
        if sibling_parsed is None:
            continue
        offsets.append(((sibling_parsed[2] - h + 180.0) % 360.0) - 180.0)
    return _format_oklch(
        max(l - CHILD_L_STEP, MIN_L),
        max(c - CHILD_C_STEP, min(c, MIN_C)),
        _next_child_hue(h, offsets),
    )


def _recolor_timeline(rows):
    """rows: (id, parent_id, position, color). Returns {id: new_color} for all."""
    children = defaultdict(list)
    for row in rows:
        children[row[1]].append(row)
    for siblings in children.values():
        siblings.sort(key=lambda row: row[2])

    new_colors = {}
    effective = {}

    decided = []
    for row_id, _parent, _position, _color in children.get(None, []):
        color = _root_color(decided)
        decided.append(color)
        effective[row_id] = color
        new_colors[row_id] = color

    def walk(parent_id):
        placed = []
        for row_id, _parent, _position, _color in children.get(parent_id, []):
            if parent_id is not None:
                color = _child_color(effective.get(parent_id), placed)
                effective[row_id] = color
                new_colors[row_id] = color
                placed.append(color)
            walk(row_id)

    walk(None)

    # Orphans (parent_id not among this timeline's rows) still get a color.
    for row_id, _parent, _position, _color in rows:
        if row_id in new_colors:
            continue
        color = _root_color(decided)
        decided.append(color)
        new_colors[row_id] = color

    return new_colors


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, timeline_id, parent_id, position, color FROM timeline_tracks "
            "ORDER BY timeline_id, parent_id NULLS FIRST, position, created_at"
        )
    ).fetchall()

    by_timeline = defaultdict(list)
    for row_id, timeline_id, parent_id, position, color in rows:
        by_timeline[timeline_id].append((row_id, parent_id, position, color))

    update = sa.text("UPDATE timeline_tracks SET color = :color WHERE id = :id")
    for timeline_rows in by_timeline.values():
        for row_id, color in _recolor_timeline(timeline_rows).items():
            conn.execute(update, {"id": row_id, "color": color})


def downgrade() -> None:
    # Data-only repaint; the previous per-track colors are not recoverable.
    pass

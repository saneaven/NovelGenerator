"""Timeline track colors: oklch strings only, backfill everything else, NOT NULL.

Any track whose color is not already a valid oklch string gets one from the
same algorithm used at creation time: roots spread hues apart, children derive
from their parent, darker with depth.

Color helpers are self-contained copies of App/backend/utils/timeline_colors.py
(migrations must not import app code; see 0007).
"""

from __future__ import annotations

import re
from collections import defaultdict

import sqlalchemy as sa
from alembic import op


revision = "0024_timeline_track_color"
down_revision = "0023_timeline_gregorian"
branch_labels = None
depends_on = None


ROOT_L = 0.68
ROOT_C = 0.14
SEED_HUE = 250.0
CHILD_L_STEP = 0.06
MIN_L = 0.40
CHILD_C_STEP = 0.015
MIN_C = 0.08
CHILD_HUE_BASE = 10.0
CHILD_HUE_STEP = 5.0
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


def _normalize(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    parsed = _parse_oklch(text)
    if parsed is not None:
        return _format_oklch(*parsed)
    return None


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


def _child_color(parent_color, sibling_index):
    parsed = _parse_oklch(parent_color) if parent_color else None
    if parsed is None:
        return _format_oklch(ROOT_L, ROOT_C, SEED_HUE)
    l, c, h = parsed
    k = max(sibling_index, 0)
    offset = min(CHILD_HUE_BASE + CHILD_HUE_STEP * (k // 2), CHILD_HUE_MAX)
    sign = 1.0 if k % 2 == 0 else -1.0
    return _format_oklch(
        max(l - CHILD_L_STEP, MIN_L),
        max(c - CHILD_C_STEP, min(c, MIN_C)),
        (h + sign * offset) % 360.0,
    )


def _backfill_timeline(rows):
    """rows: (id, parent_id, position, color). Returns {id: new_color} diffs."""
    children = defaultdict(list)
    for row in rows:
        children[row[1]].append(row)
    for siblings in children.values():
        siblings.sort(key=lambda row: row[2])

    changes = {}
    effective = {}

    roots = children.get(None, [])
    decided = [color for color in (_normalize(row[3]) for row in roots) if color]
    for row_id, _parent, _position, color in roots:
        normalized = _normalize(color)
        if normalized is None:
            normalized = _root_color(decided)
            decided.append(normalized)
        effective[row_id] = normalized
        if normalized != color:
            changes[row_id] = normalized

    def walk(parent_id):
        for index, (row_id, _parent, _position, color) in enumerate(
            children.get(parent_id, [])
        ):
            if parent_id is not None:
                normalized = _normalize(color)
                if normalized is None:
                    normalized = _child_color(effective.get(parent_id), index)
                effective[row_id] = normalized
                if normalized != color:
                    changes[row_id] = normalized
            walk(row_id)

    walk(None)

    for row_id, _parent, _position, color in rows:
        if row_id in effective:
            continue
        normalized = _normalize(color) or _format_oklch(ROOT_L, ROOT_C, SEED_HUE)
        effective[row_id] = normalized
        if normalized != color:
            changes[row_id] = normalized

    return changes


def upgrade() -> None:
    op.alter_column(
        "timeline_tracks",
        "color",
        existing_type=sa.String(20),
        type_=sa.String(32),
        existing_nullable=True,
    )

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
        for row_id, color in _backfill_timeline(timeline_rows).items():
            conn.execute(update, {"id": row_id, "color": color})

    op.alter_column(
        "timeline_tracks",
        "color",
        existing_type=sa.String(32),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "timeline_tracks",
        "color",
        existing_type=sa.String(32),
        nullable=True,
    )
    # Postgres cannot narrow a varchar below existing data; drop long values first.
    op.get_bind().execute(
        sa.text("UPDATE timeline_tracks SET color = NULL WHERE length(color) > 20")
    )
    op.alter_column(
        "timeline_tracks",
        "color",
        existing_type=sa.String(32),
        type_=sa.String(20),
        existing_nullable=True,
    )

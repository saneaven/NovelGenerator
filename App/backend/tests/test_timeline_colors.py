from __future__ import annotations

import math

from App.backend.utils.timeline_colors import (
    MIN_L,
    ROOT_C,
    ROOT_L,
    SEED_HUE,
    backfill_missing_colors,
    child_track_color,
    format_oklch,
    hex_to_oklch,
    next_child_hue,
    next_root_hue,
    normalize_track_color,
    oklch_to_hex,
    parse_oklch,
    root_track_color,
)


def test_parse_format_roundtrip() -> None:
    assert parse_oklch("oklch(0.680 0.140 250.0)") == (0.68, 0.14, 250.0)
    assert format_oklch(0.68, 0.14, 250.0) == "oklch(0.680 0.140 250.0)"
    value = format_oklch(0.512345, 0.0789, 137.456)
    parsed = parse_oklch(value)
    assert parsed is not None
    assert format_oklch(*parsed) == value


def test_parse_tolerates_loose_css_forms() -> None:
    assert parse_oklch("oklch(68% 0.14 250deg)") == (0.68, 0.14, 250.0)
    assert parse_oklch("oklch(0.68 0.14 250 / 0.5)") == (0.68, 0.14, 250.0)
    assert parse_oklch("oklch(0.68 0.14 380)") == (0.68, 0.14, 20.0)
    assert parse_oklch("not a color") is None
    assert parse_oklch("#ff0000") is None


def test_format_stays_within_column_width() -> None:
    assert len(format_oklch(0.999, 0.999, 359.9)) <= 32
    # rounding to 360.0 must wrap back to 0
    assert format_oklch(0.5, 0.1, 359.99) == "oklch(0.500 0.100 0.0)"


def test_normalize_track_color() -> None:
    assert normalize_track_color(None) is None
    assert normalize_track_color("") is None
    assert normalize_track_color("   ") is None
    assert normalize_track_color("garbage") is None
    assert normalize_track_color("red") is None
    assert normalize_track_color("oklch(0.7 0.14 30)") == "oklch(0.700 0.140 30.0)"
    assert normalize_track_color("#ff0000") is not None
    assert normalize_track_color("#xyz") is None


def test_hex_oklch_roundtrip() -> None:
    for source in ("#ff0000", "#3366cc", "#00aa88", "#111111", "#fafafa"):
        as_oklch = hex_to_oklch(source)
        assert as_oklch is not None
        parsed = parse_oklch(as_oklch)
        assert parsed is not None
        back = oklch_to_hex(*parsed)
        # sRGB → oklch → sRGB should land within rounding distance per channel
        for i in (1, 3, 5):
            assert abs(int(source[i : i + 2], 16) - int(back[i : i + 2], 16)) <= 2
    assert hex_to_oklch("#fff") == hex_to_oklch("#ffffff")


def test_next_root_hue_gap_bisection() -> None:
    assert next_root_hue([]) == SEED_HUE
    assert next_root_hue([250.0]) == (250.0 + 180.0) % 360.0
    # two hues → bisect the larger arc (70 → 250 going through 160)
    assert next_root_hue([250.0, 70.0]) in (160.0, 340.0)
    # hue wheel wraparound: gap between 350 and 10 is small; pick the big arc
    hue = next_root_hue([350.0, 10.0])
    assert math.isclose(hue, 180.0)
    # duplicates collapse
    assert next_root_hue([90.0, 90.0]) == 270.0


def test_root_track_color_ignores_neutrals_and_invalid() -> None:
    assert root_track_color([]) == format_oklch(ROOT_L, ROOT_C, SEED_HUE)
    # neutral (low chroma) and unparseable colors must not constrain placement
    assert root_track_color(["oklch(0.55 0.01 123)", None, "garbage"]) == format_oklch(
        ROOT_L, ROOT_C, SEED_HUE
    )
    single = root_track_color(["oklch(0.68 0.14 250)"])
    assert parse_oklch(single)[2] == 70.0


def test_next_child_hue_band_gap_bisection() -> None:
    # first child seeds at the +CHILD_HUE_MAX edge
    assert next_child_hue(250.0, []) == 275.0
    # second child goes to the opposite edge (farthest from the first)
    assert next_child_hue(250.0, [25.0]) == 225.0
    # third child bisects the band center
    assert next_child_hue(250.0, [-25.0, 25.0]) == 250.0
    # offsets beyond the band are clamped, never escaping ±CHILD_HUE_MAX
    assert next_child_hue(250.0, [200.0]) == 225.0


def test_child_track_color_gap_and_floors() -> None:
    parent = "oklch(0.680 0.140 250.0)"
    siblings: list[str] = []
    hues = []
    for _ in range(6):
        child = child_track_color(parent, siblings)
        l, c, h = parse_oklch(child)
        assert math.isclose(l, 0.62)
        assert math.isclose(c, 0.125)
        # children spread across the band but never escape ±25°
        assert 225.0 <= h <= 275.0
        hues.append(h)
        siblings.append(child)
    # first child anchors at +25°; the rest fill the band without repeating
    assert hues[0] == 275.0
    assert len(set(hues)) == len(hues)

    # lightness floors at MIN_L over many generations
    color = parent
    for _ in range(10):
        color = child_track_color(color, [])
    assert parse_oklch(color)[0] == MIN_L

    # a neutral parent must not produce colorful children
    neutral_child = child_track_color("oklch(0.550 0.010 0.0)", [])
    assert parse_oklch(neutral_child)[1] <= 0.01

    # unparseable parent falls back to the seed color family
    assert child_track_color(None, []) == format_oklch(ROOT_L, ROOT_C, SEED_HUE)
    assert child_track_color("garbage", []) == format_oklch(ROOT_L, ROOT_C, SEED_HUE)


def test_backfill_preserves_existing_and_fills_missing() -> None:
    rows = [
        ("r1", None, 0, "oklch(0.550 0.150 25.0)"),   # valid → untouched
        ("r2", None, 1, None),                         # missing → assigned
        ("r3", None, 2, "junk"),                       # invalid → assigned
        ("c1", "r1", 0, None),                         # child derives from r1
        ("c2", "r1", 1, "oklch(0.600 0.100 30.0)"),   # explicit child kept
        ("g1", "c1", 0, None),                         # grandchild derives from c1
    ]
    changes = backfill_missing_colors(rows)

    assert "r1" not in changes
    assert "c2" not in changes

    r2 = parse_oklch(changes["r2"])
    assert r2 is not None and (r2[0], r2[1]) == (ROOT_L, ROOT_C)
    r3 = parse_oklch(changes["r3"])
    assert r3 is not None and (r3[0], r3[1]) == (ROOT_L, ROOT_C)
    assert r2[2] != r3[2]

    c1 = parse_oklch(changes["c1"])
    assert math.isclose(c1[0], 0.55 - 0.06)
    # c1 fills the band away from its explicit sibling c2 (parent hue 25 + offset 5)
    assert math.isclose(c1[2], 0.0)

    g1 = parse_oklch(changes["g1"])
    assert g1[0] < c1[0]

    # orphan rows still get a color (corrupt parent references must not crash imports)
    orphan_changes = backfill_missing_colors([("x", "missing-parent", 0, None)])
    assert parse_oklch(orphan_changes["x"]) is not None

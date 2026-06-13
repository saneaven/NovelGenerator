import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../types/timeline';
import {
  baseUnitsPerTopUnit,
  compareTimelineDates,
  dateUnitMax,
  defaultCalendar,
  durationBreakdown,
  formatAnchorLabel,
  toBaseUnits,
  unitLabelTokens,
  wholeTopUnitsBetween,
} from './timelineCalendar';

const GREGORIAN = defaultCalendar();

const AGE_CALENDAR: CalendarConfig = {
  mode: 'fixed',
  units: [
    { name: 'age', label: 'Age', count: 3 },
    { name: 'season', label: 'Season', count: 90 },
    { name: 'day', label: 'Day' },
  ],
};

const FLAT_CALENDAR: CalendarConfig = {
  mode: 'fixed',
  units: [{ name: 'day', label: 'Day' }],
};

describe('compareTimelineDates', () => {
  it('orders by base position', () => {
    const a = { year: 1, month: 1, day: 1 };
    const b = { year: 1, month: 1, day: 2 };
    expect(compareTimelineDates(a, b, GREGORIAN)).toBeLessThan(0);
    expect(compareTimelineDates(b, a, GREGORIAN)).toBeGreaterThan(0);
    expect(compareTimelineDates(a, { ...a }, GREGORIAN)).toBe(0);
  });
});

describe('dateUnitMax', () => {
  it('leaves the top unit open-ended (no max), not its own count', () => {
    // regression: the top unit's count is "children per parent", NOT a cap on
    // the top unit itself — year must not be capped at 12 / age at 3.
    expect(dateUnitMax(AGE_CALENDAR, { age: 1, season: 1, day: 1 }, 'age')).toBeUndefined();
    expect(dateUnitMax(GREGORIAN, { year: 1, month: 1, day: 1 }, 'year')).toBeUndefined();
  });

  it('caps each child unit by its parent unit count', () => {
    expect(dateUnitMax(AGE_CALENDAR, { age: 1, season: 1, day: 1 }, 'season')).toBe(3);
    expect(dateUnitMax(AGE_CALENDAR, { age: 1, season: 1, day: 1 }, 'day')).toBe(90);
  });

  it('uses gregorian-aware bounds for gregorian calendars', () => {
    expect(dateUnitMax(GREGORIAN, { year: 2024, month: 2, day: 1 }, 'month')).toBe(12);
    expect(dateUnitMax(GREGORIAN, { year: 2024, month: 2, day: 1 }, 'day')).toBe(29);
    expect(dateUnitMax(GREGORIAN, { year: 2023, month: 2, day: 1 }, 'day')).toBe(28);
  });
});

describe('baseUnitsPerTopUnit', () => {
  it('uses the mean gregorian year', () => {
    expect(baseUnitsPerTopUnit(GREGORIAN)).toBeCloseTo(365.2425 * 24 * 60);
  });

  it('multiplies fixed unit counts', () => {
    expect(baseUnitsPerTopUnit(AGE_CALENDAR)).toBe(3 * 90);
  });

  it('is 1 for single-unit calendars (top == base)', () => {
    expect(baseUnitsPerTopUnit(FLAT_CALENDAR)).toBe(1);
  });
});

describe('wholeTopUnitsBetween (gregorian)', () => {
  it('does not count a Dec→Jan boundary as a year', () => {
    expect(wholeTopUnitsBetween(
      { year: 1023, month: 12, day: 15 },
      { year: 1024, month: 1, day: 2 },
      GREGORIAN,
    )).toBe(0);
  });

  it('needs a full anniversary to count one year', () => {
    expect(wholeTopUnitsBetween(
      { year: 1024, month: 3, day: 5 },
      { year: 1025, month: 3, day: 4 },
      GREGORIAN,
    )).toBe(0);
    expect(wholeTopUnitsBetween(
      { year: 1024, month: 3, day: 5 },
      { year: 1025, month: 3, day: 5 },
      GREGORIAN,
    )).toBe(1);
    expect(wholeTopUnitsBetween(
      { year: 1024, month: 3, day: 5 },
      { year: 1027, month: 3, day: 5 },
      GREGORIAN,
    )).toBe(3);
  });

  it('clamps Feb-29 anniversaries in non-leap years', () => {
    expect(wholeTopUnitsBetween(
      { year: 2024, month: 2, day: 29 },
      { year: 2025, month: 2, day: 28 },
      GREGORIAN,
    )).toBe(1);
    expect(wholeTopUnitsBetween(
      { year: 2024, month: 2, day: 29 },
      { year: 2025, month: 2, day: 27 },
      GREGORIAN,
    )).toBe(0);
  });

  it('compares hours and minutes on the anniversary day', () => {
    expect(wholeTopUnitsBetween(
      { year: 1024, month: 3, day: 5, hour: 11, minute: 31 },
      { year: 1025, month: 3, day: 5, hour: 10, minute: 1 },
      GREGORIAN,
    )).toBe(0);
    expect(wholeTopUnitsBetween(
      { year: 1024, month: 3, day: 5, hour: 11, minute: 31 },
      { year: 1025, month: 3, day: 5, hour: 11, minute: 31 },
      GREGORIAN,
    )).toBe(1);
  });

  it('never returns a negative count', () => {
    expect(wholeTopUnitsBetween(
      { year: 1025, month: 1, day: 1 },
      { year: 1024, month: 1, day: 1 },
      GREGORIAN,
    )).toBe(0);
  });
});

describe('wholeTopUnitsBetween (fixed)', () => {
  it('counts whole top units via the top multiplier', () => {
    const a = { age: 1, season: 1, day: 1 };
    expect(wholeTopUnitsBetween(a, { age: 4, season: 1, day: 1 }, AGE_CALENDAR)).toBe(3);
    expect(wholeTopUnitsBetween(a, { age: 2, season: 1, day: 1 }, AGE_CALENDAR)).toBe(1);
    // one day short of a whole age
    expect(wholeTopUnitsBetween(a, { age: 1, season: 3, day: 90 }, AGE_CALENDAR)).toBe(0);
  });

  it('treats single-unit calendars as base deltas', () => {
    expect(wholeTopUnitsBetween({ day: 1 }, { day: 25 }, FLAT_CALENDAR)).toBe(24);
  });
});

describe('formatAnchorLabel', () => {
  it('shows top unit first and trims trailing defaults on the first anchor', () => {
    const label = formatAnchorLabel({ year: 1023, month: 3, day: 12, hour: 1, minute: 1 }, null, GREGORIAN);
    expect(label.parts).toEqual([
      { text: 'Y1023', rank: 0 },
      { text: 'M3', rank: 1 },
      { text: 'D12', rank: 2 },
    ]);
    expect(label.rank).toBe(0);
  });

  it('keeps a non-default clock on the first anchor', () => {
    const label = formatAnchorLabel({ year: 1023, month: 1, day: 1, hour: 15, minute: 32 }, null, GREGORIAN);
    expect(label.parts).toEqual([
      { text: 'Y1023', rank: 0 },
      { text: 'M1', rank: 1 },
      { text: 'D1', rank: 2 },
      { text: '14:31', rank: 3 },
    ]);
  });

  it('starts at the highest changed unit', () => {
    const prev = { year: 1023, month: 3, day: 12 };
    const label = formatAnchorLabel({ year: 1023, month: 9, day: 12 }, prev, GREGORIAN);
    expect(label.parts).toEqual([{ text: 'M9', rank: 1 }]);
    expect(label.rank).toBe(1);
  });

  it('extends down to the lowest changed unit', () => {
    const prev = { year: 1023, month: 3, day: 12 };
    const label = formatAnchorLabel({ year: 1024, month: 3, day: 4 }, prev, GREGORIAN);
    expect(label.parts).toEqual([
      { text: 'Y1024', rank: 0 },
      { text: 'M3', rank: 1 },
      { text: 'D4', rank: 2 },
    ]);
  });

  it('disambiguates near-coincident anchors via the clock', () => {
    const prev = { year: 1023, month: 3, day: 12, hour: 15, minute: 32 };
    const label = formatAnchorLabel({ year: 1023, month: 3, day: 12, hour: 15, minute: 33 }, prev, GREGORIAN);
    expect(label.parts).toEqual([{ text: '14:32', rank: 3 }]);
    expect(label.rank).toBe(3);
  });

  it('uses user-authored labels for fixed calendars', () => {
    const label = formatAnchorLabel({ age: 3, season: 2, day: 1 }, { age: 3, season: 1, day: 1 }, AGE_CALENDAR);
    expect(label.parts).toEqual([{ text: 'Season 2', rank: 1 }]);
  });
});

describe('unitLabelTokens', () => {
  it('returns every gregorian unit token, top unit first', () => {
    expect(unitLabelTokens({ year: 1023, month: 3, day: 12, hour: 15, minute: 33 }, GREGORIAN))
      .toEqual(['Y1023', 'M3', 'D12', '14:32']);
  });

  it('uses user-authored labels for fixed calendars', () => {
    expect(unitLabelTokens({ age: 3, season: 2, day: 5 }, AGE_CALENDAR))
      .toEqual(['Age 3', 'Season 2', 'Day 5']);
  });
});

describe('durationBreakdown', () => {
  const base = (date: Record<string, number>) => toBaseUnits(date, GREGORIAN);

  it('returns the top two nonzero units', () => {
    const delta = base({ year: 1027, month: 8, day: 1 }) - base({ year: 1024, month: 3, day: 1 });
    const parts = durationBreakdown(delta, GREGORIAN);
    expect(parts).toHaveLength(2);
    expect(parts[0].unitName).toBe('year');
    expect(parts[0].value).toBe(3);
    expect(parts[1].unitName).toBe('month');
  });

  it('handles sub-hour durations', () => {
    expect(durationBreakdown(45, GREGORIAN)).toEqual([
      { unitName: 'minute', unitLabel: 'Minute', value: 45 },
    ]);
  });

  it('handles day+hour durations', () => {
    expect(durationBreakdown(26 * 60, GREGORIAN)).toEqual([
      { unitName: 'day', unitLabel: 'Day', value: 1 },
      { unitName: 'hour', unitLabel: 'Hour', value: 2 },
    ]);
  });

  it('decomposes fixed calendars by their own multipliers', () => {
    expect(durationBreakdown(2 * 270 + 91, AGE_CALENDAR)).toEqual([
      { unitName: 'age', unitLabel: 'Age', value: 2 },
      { unitName: 'season', unitLabel: 'Season', value: 1 },
    ]);
  });

  it('returns nothing for zero or negative deltas', () => {
    expect(durationBreakdown(0, GREGORIAN)).toEqual([]);
    expect(durationBreakdown(-5, GREGORIAN)).toEqual([]);
  });
});

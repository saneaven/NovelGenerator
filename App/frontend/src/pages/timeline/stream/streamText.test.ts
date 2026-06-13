import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../../../types/timeline';
import { defaultCalendar } from '../../../utils/timelineCalendar';
import { stickyPeriodLabel } from './streamText';

const GREGORIAN = defaultCalendar();

const AGE_CALENDAR: CalendarConfig = {
  mode: 'fixed',
  units: [
    { name: 'age', label: 'Age', count: 3 },
    { name: 'season', label: 'Season', count: 90 },
    { name: 'day', label: 'Day' },
  ],
};

describe('stickyPeriodLabel', () => {
  const date = { year: 1023, month: 3, day: 12, hour: 15, minute: 33 };

  it('fills the units omitted above a day-level card', () => {
    expect(stickyPeriodLabel(date, 2, GREGORIAN)).toBe('Y1023 M3');
  });

  it('fills year/month/day above a clock-level card', () => {
    expect(stickyPeriodLabel(date, 3, GREGORIAN)).toBe('Y1023 M3 D12');
  });

  it('shows just the year above a month-level card', () => {
    expect(stickyPeriodLabel(date, 1, GREGORIAN)).toBe('Y1023');
  });

  it('keeps the year on a year-boundary card (nothing omitted)', () => {
    expect(stickyPeriodLabel({ year: 1024, month: 1, day: 1 }, 0, GREGORIAN)).toBe('Y1024');
  });

  it('keeps the top unit for fixed calendars', () => {
    expect(stickyPeriodLabel({ age: 3, season: 2, day: 5 }, 1, AGE_CALENDAR)).toBe('Age 3');
  });
});

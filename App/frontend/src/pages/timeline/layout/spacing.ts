import type { CalendarConfig } from '../../../types/timeline';
import { baseUnitsPerTopUnit, isGregorianCalendar } from '../../../utils/timelineCalendar';
import { FLAT_CALENDAR_BREAK_MIN, type SpacingConfig } from './types';

/** Reference delta for gap scaling: base units in one top calendar unit. */
export function gapReferenceBase(calendar: CalendarConfig): number {
  const perTop = baseUnitsPerTopUnit(calendar);
  // single-unit calendars: top == base, so scale against the break threshold instead
  return perTop === 1 ? FLAT_CALENDAR_BREAK_MIN : perTop;
}

/**
 * Log-scaled, clamped vertical gap for a base-unit delta between consecutive anchors.
 * Monotone in `delta`, hits maxGap exactly at one top unit (where breaks take over).
 */
export function gapForDelta(delta: number, referenceBase: number, spacing: SpacingConfig): number {
  if (delta <= 0) return spacing.minGap;
  const t = Math.log1p(delta) / Math.log1p(referenceBase);
  return Math.round(spacing.minGap + (spacing.maxGap - spacing.minGap) * Math.min(t, 1));
}

/** Minimum whole-top-unit count for a gap to become a break separator. */
export function breakThreshold(calendar: CalendarConfig): number {
  if (!isGregorianCalendar(calendar) && calendar.units.length === 1) return FLAT_CALENDAR_BREAK_MIN;
  return 1;
}

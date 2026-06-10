import { useCallback, useMemo } from 'react';
import type { CalendarConfig, CalendarUnit, TimelineDate, TimelineEvent } from '../../../types/timeline';
import { toBaseUnits, fromBaseUnits, isGregorianCalendar } from '../../../utils/timelineCalendar';
import type { TimelineViewport } from './useTimelineLayout';

export interface RulerTick {
  position: number; // pixel X
  basePosition: number; // base units
  label: string;
  level: 'major' | 'minor';
}

const MIN_TICK_SPACING = 60; // px between minor ticks
const MAX_TICK_SPACING = 200;
const GREGORIAN_TICK_UNITS = [
  { unit: 'minute', approxBase: 1 },
  { unit: 'hour', approxBase: 60 },
  { unit: 'day', approxBase: 24 * 60 },
  { unit: 'month', approxBase: 30 * 24 * 60 },
  { unit: 'year', approxBase: 365 * 24 * 60 },
] as const;

type GregorianTickUnit = typeof GREGORIAN_TICK_UNITS[number]['unit'];

/**
 * Determine which calendar unit level to use for minor ticks,
 * and which for major ticks based on current zoom scale.
 */
function pickTickUnit(units: CalendarUnit[], scale: number): { majorIdx: number; minorIdx: number; minorStep: number } {
  // Try each unit as minor tick. The one where adjacent ticks are ~60-200px apart wins.
  for (let i = units.length - 1; i >= 0; i--) {
    // One increment of this unit = its multiplier in base units
    let multiplier = 1;
    for (let j = i; j < units.length; j++) {
      const count = units[j].count;
      if (!Number.isInteger(count)) break;
      multiplier *= Number(count);
    }

    const pixelsPerTick = multiplier / scale;
    if (pixelsPerTick >= MIN_TICK_SPACING && pixelsPerTick <= MAX_TICK_SPACING) {
      return {
        minorIdx: i,
        majorIdx: Math.max(0, i - 1),
        minorStep: 1,
      };
    }
    // If ticks are too dense, try stepping by 2, 5, 10
    if (pixelsPerTick < MIN_TICK_SPACING) {
      for (const step of [2, 5, 10, 20, 50, 100]) {
        if (pixelsPerTick * step >= MIN_TICK_SPACING) {
          return {
            minorIdx: i,
            majorIdx: Math.max(0, i - 1),
            minorStep: step,
          };
        }
      }
    }
  }
  // Fallback: use the largest unit
  return { majorIdx: 0, minorIdx: 0, minorStep: 1 };
}

function pickGregorianTickUnit(scale: number): { unit: GregorianTickUnit; step: number } {
  for (const candidate of GREGORIAN_TICK_UNITS) {
    const pixelsPerTick = candidate.approxBase / scale;
    if (pixelsPerTick >= MIN_TICK_SPACING && pixelsPerTick <= MAX_TICK_SPACING) {
      return { unit: candidate.unit, step: 1 };
    }
    if (pixelsPerTick < MIN_TICK_SPACING) {
      for (const step of [2, 5, 10, 20, 50, 100]) {
        if (pixelsPerTick * step >= MIN_TICK_SPACING) {
          return { unit: candidate.unit, step };
        }
      }
    }
  }
  return { unit: 'year', step: 1 };
}

function addGregorianMonths(date: TimelineDate, delta: number): TimelineDate {
  const year = Number(date.year ?? 1);
  const month = Number(date.month ?? 1);
  const totalMonths = ((year - 1) * 12) + (month - 1) + delta;
  const nextYear = Math.floor(Math.max(0, totalMonths) / 12) + 1;
  const nextMonth = (Math.max(0, totalMonths) % 12) + 1;
  return { year: nextYear, month: nextMonth, day: 1, hour: 1, minute: 1 };
}

function addGregorianYears(date: TimelineDate, delta: number): TimelineDate {
  return {
    year: Math.max(1, Number(date.year ?? 1) + delta),
    month: 1,
    day: 1,
    hour: 1,
    minute: 1,
  };
}

function gregorianRulerTicks(
  calendar: CalendarConfig,
  viewport: TimelineViewport,
  originBase: number,
): RulerTick[] {
  const { unit, step } = pickGregorianTickUnit(viewport.scale);
  const visibleStartBase = viewport.scrollOffset;
  const visibleEndBase = viewport.scrollOffset + viewport.viewportWidth * viewport.scale;
  const visStartPx = (visibleStartBase - originBase) / viewport.scale;
  const visEndPx = (visibleEndBase - originBase) / viewport.scale;
  const ticks: RulerTick[] = [];

  const pushTick = (basePos: number, level: RulerTick['level'], label: string) => {
    const px = (basePos - originBase) / viewport.scale;
    if (px < visStartPx - 100 || px > visEndPx + 100) return;
    ticks.push({ position: px, basePosition: basePos, label, level });
  };

  if (unit === 'month' || unit === 'year') {
    const visibleDate = fromBaseUnits(Math.max(0, Math.floor(visibleStartBase)), calendar);
    let cursor = unit === 'month'
      ? addGregorianMonths({ ...visibleDate, day: 1, hour: 1, minute: 1 }, -step)
      : addGregorianYears({ ...visibleDate, month: 1, day: 1, hour: 1, minute: 1 }, -step);

    for (let guard = 0; guard < 500; guard += 1) {
      const basePos = toBaseUnits(cursor, calendar);
      if (basePos > visibleEndBase + (400 * viewport.scale)) break;
      const isMajor = unit === 'year' || Number(cursor.month ?? 1) === 1;
      const label = isMajor ? `Year ${cursor.year ?? 1}` : `M${cursor.month ?? 1}`;
      pushTick(basePos, isMajor ? 'major' : 'minor', label);
      cursor = unit === 'month' ? addGregorianMonths(cursor, step) : addGregorianYears(cursor, step);
    }
    return ticks;
  }

  const baseByUnit: Record<'minute' | 'hour' | 'day', number> = {
    minute: 1,
    hour: 60,
    day: 24 * 60,
  };
  const stepBase = baseByUnit[unit] * step;
  const startTick = Math.floor(Math.max(0, visibleStartBase) / stepBase) - 1;
  const endTick = Math.ceil(visibleEndBase / stepBase) + 1;

  for (let i = startTick; i <= endTick; i += 1) {
    const basePos = i * stepBase;
    if (basePos < 0) continue;
    const date = fromBaseUnits(basePos, calendar);
    if (unit === 'day') {
      const isMajor = Number(date.day ?? 1) === 1;
      pushTick(basePos, isMajor ? 'major' : 'minor', isMajor ? `M${date.month ?? 1}` : `D${date.day ?? 1}`);
    } else if (unit === 'hour') {
      const isMajor = Number(date.hour ?? 1) === 1;
      pushTick(basePos, isMajor ? 'major' : 'minor', isMajor ? `D${date.day ?? 1}` : `H${date.hour ?? 1}`);
    } else {
      const isMajor = Number(date.minute ?? 1) === 1;
      pushTick(basePos, isMajor ? 'major' : 'minor', isMajor ? `H${date.hour ?? 1}` : `m${date.minute ?? 1}`);
    }
  }

  return ticks;
}

export function useTimelinePositioning(
  calendar: CalendarConfig,
  viewport: TimelineViewport,
  originBase: number,
  contentMaxBase: number,
  gutterBase: number,
) {
  const units = calendar.units;

  // Positions are absolute within the (natively scrolled) canvas, measured from
  // originBase (the base value at pixel 0). scrollOffset is NOT subtracted here —
  // the browser handles horizontal scroll.
  const dateToPixel = useCallback(
    (date: TimelineDate): number => {
      const base = toBaseUnits(date, calendar);
      return (base - originBase) / viewport.scale;
    },
    [calendar, originBase, viewport.scale],
  );

  const pixelToBaseUnits = useCallback(
    (px: number): number => {
      // px is absolute within the canvas content (getBoundingClientRect already
      // accounts for native scroll); add originBase to recover the base value.
      return px * viewport.scale + originBase;
    },
    [originBase, viewport.scale],
  );

  const pixelToDate = useCallback(
    (px: number): TimelineDate => {
      const base = pixelToBaseUnits(px);
      return fromBaseUnits(Math.max(0, Math.round(base)), calendar);
    },
    [pixelToBaseUnits, calendar],
  );

  const eventLeft = useCallback(
    (event: TimelineEvent): number => {
      return dateToPixel(event.startDate);
    },
    [dateToPixel],
  );

  const eventWidth = useCallback(
    (event: TimelineEvent): number | null => {
      if (!event.endDate) return null; // point event
      const startPx = dateToPixel(event.startDate);
      const endPx = dateToPixel(event.endDate);
      return Math.max(4, endPx - startPx);
    },
    [dateToPixel],
  );

  /**
   * Total width of the canvas in pixels: content span plus a symmetric right gutter (the
   * left gutter already lives in originBase). Uses the same gutterBase as the scroll clamp's
   * right bound so native drag-scroll and zoom-driven scroll stop at the same place.
   */
  const canvasWidth = useMemo(() => {
    const contentWidth = (contentMaxBase + gutterBase - originBase) / viewport.scale;
    return Math.max(contentWidth, viewport.viewportWidth);
  }, [contentMaxBase, gutterBase, originBase, viewport.scale, viewport.viewportWidth]);

  const rulerTicks = useMemo((): RulerTick[] => {
    if (units.length === 0) return [];
    if (isGregorianCalendar(calendar)) {
      return gregorianRulerTicks(calendar, viewport, originBase);
    }

    const { majorIdx, minorIdx, minorStep } = pickTickUnit(units, viewport.scale);
    const ticks: RulerTick[] = [];

    // Calculate multiplier for minor unit
    let minorMultiplier = 1;
    for (let j = minorIdx; j < units.length; j++) {
      const count = units[j].count;
      if (!Number.isInteger(count)) break;
      minorMultiplier *= Number(count);
    }

    // Calculate multiplier for major unit
    let majorMultiplier = 1;
    for (let j = majorIdx; j < units.length; j++) {
      const count = units[j].count;
      if (!Number.isInteger(count)) break;
      majorMultiplier *= Number(count);
    }

    const visibleStartBase = viewport.scrollOffset;
    const visibleEndBase = viewport.scrollOffset + viewport.viewportWidth * viewport.scale;

    // Generate minor ticks
    const stepBase = minorMultiplier * minorStep;
    const startTick = Math.floor(visibleStartBase / stepBase) - 1;
    const endTick = Math.ceil(visibleEndBase / stepBase) + 1;

    const majorStepBase = majorMultiplier;
    const seenMajor = new Set<number>();

    // Absolute visible pixel window (positions are measured from originBase).
    const visStartPx = (visibleStartBase - originBase) / viewport.scale;
    const visEndPx = (visibleEndBase - originBase) / viewport.scale;

    for (let i = startTick; i <= endTick; i++) {
      const basePos = i * stepBase;
      const px = (basePos - originBase) / viewport.scale;

      if (px < visStartPx - 100 || px > visEndPx + 100) continue;

      // Check if this is also a major tick
      const majorValue = Math.floor(basePos / majorStepBase);
      const isMajor = majorIdx !== minorIdx && basePos % majorStepBase === 0 && !seenMajor.has(majorValue);
      if (isMajor) seenMajor.add(majorValue);

      const date = fromBaseUnits(Math.max(0, basePos), calendar);
      const label = isMajor
        ? `${units[majorIdx].label} ${date[units[majorIdx].name] ?? 1}`
        : `${units[minorIdx].label.charAt(0)}${date[units[minorIdx].name] ?? 1}`;

      ticks.push({
        position: px,
        basePosition: basePos,
        label,
        level: isMajor ? 'major' : 'minor',
      });
    }

    return ticks;
  }, [calendar, units, originBase, viewport]);

  return {
    dateToPixel,
    pixelToDate,
    pixelToBaseUnits,
    eventLeft,
    eventWidth,
    canvasWidth,
    rulerTicks,
  };
}

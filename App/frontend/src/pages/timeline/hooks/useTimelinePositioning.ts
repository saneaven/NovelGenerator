import { useCallback, useMemo } from 'react';
import type { CalendarConfig, CalendarUnit, TimelineDate, TimelineEvent } from '../../../types/timeline';
import { toBaseUnits, fromBaseUnits } from '../../../utils/timelineCalendar';
import type { TimelineViewport } from './useTimelineLayout';

export interface RulerTick {
  position: number; // pixel X
  basePosition: number; // base units
  label: string;
  level: 'major' | 'minor';
}

const MIN_TICK_SPACING = 60; // px between minor ticks
const MAX_TICK_SPACING = 200;

/**
 * Determine which calendar unit level to use for minor ticks,
 * and which for major ticks based on current zoom scale.
 */
function pickTickUnit(units: CalendarUnit[], scale: number): { majorIdx: number; minorIdx: number; minorStep: number } {
  // Try each unit as minor tick. The one where adjacent ticks are ~60-200px apart wins.
  for (let i = units.length - 1; i >= 0; i--) {
    // One increment of this unit = its multiplier in base units
    let multiplier = 1;
    for (let j = i + 1; j < units.length; j++) {
      const count = units[j].count;
      if (count && Number.isInteger(count)) multiplier *= count;
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

export function useTimelinePositioning(calendar: CalendarConfig, viewport: TimelineViewport) {
  const units = calendar.units;

  const dateToPixel = useCallback(
    (date: TimelineDate): number => {
      const base = toBaseUnits(date, units);
      return (base - viewport.scrollOffset) / viewport.scale;
    },
    [units, viewport.scrollOffset, viewport.scale],
  );

  const pixelToBaseUnits = useCallback(
    (px: number): number => {
      return px * viewport.scale + viewport.scrollOffset;
    },
    [viewport.scrollOffset, viewport.scale],
  );

  const pixelToDate = useCallback(
    (px: number): TimelineDate => {
      const base = pixelToBaseUnits(px);
      return fromBaseUnits(Math.max(0, Math.round(base)), units);
    },
    [pixelToBaseUnits, units],
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

  /** Total width of the canvas in pixels, based on all possible content. */
  const canvasWidth = useMemo(() => {
    // Provide a generous default width; the actual content determines scroll range
    return Math.max(viewport.viewportWidth * 3, 2000);
  }, [viewport.viewportWidth]);

  const rulerTicks = useMemo((): RulerTick[] => {
    if (units.length === 0) return [];

    const { majorIdx, minorIdx, minorStep } = pickTickUnit(units, viewport.scale);
    const ticks: RulerTick[] = [];

    // Calculate multiplier for minor unit
    let minorMultiplier = 1;
    for (let j = minorIdx + 1; j < units.length; j++) {
      const count = units[j].count;
      if (count && Number.isInteger(count)) minorMultiplier *= count;
    }

    // Calculate multiplier for major unit
    let majorMultiplier = 1;
    for (let j = majorIdx + 1; j < units.length; j++) {
      const count = units[j].count;
      if (count && Number.isInteger(count)) majorMultiplier *= count;
    }

    const visibleStartBase = viewport.scrollOffset;
    const visibleEndBase = viewport.scrollOffset + viewport.viewportWidth * viewport.scale;

    // Generate minor ticks
    const stepBase = minorMultiplier * minorStep;
    const startTick = Math.floor(visibleStartBase / stepBase) - 1;
    const endTick = Math.ceil(visibleEndBase / stepBase) + 1;

    const majorStepBase = majorMultiplier;
    const seenMajor = new Set<number>();

    for (let i = startTick; i <= endTick; i++) {
      const basePos = i * stepBase;
      const px = (basePos - viewport.scrollOffset) / viewport.scale;

      if (px < -100 || px > viewport.viewportWidth + 100) continue;

      // Check if this is also a major tick
      const majorValue = Math.floor(basePos / majorStepBase);
      const isMajor = majorIdx !== minorIdx && basePos % majorStepBase === 0 && !seenMajor.has(majorValue);
      if (isMajor) seenMajor.add(majorValue);

      const date = fromBaseUnits(Math.max(0, basePos), units);
      const label = isMajor
        ? `${units[majorIdx].label} ${date[units[majorIdx].name] ?? 0}`
        : `${units[minorIdx].label.charAt(0)}${date[units[minorIdx].name] ?? 0}`;

      ticks.push({
        position: px,
        basePosition: basePos,
        label,
        level: isMajor ? 'major' : 'minor',
      });
    }

    return ticks;
  }, [units, viewport.scrollOffset, viewport.scale, viewport.viewportWidth]);

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

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
      const base = toBaseUnits(date, units);
      return (base - originBase) / viewport.scale;
    },
    [units, originBase, viewport.scale],
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

      const date = fromBaseUnits(Math.max(0, basePos), units);
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
  }, [units, originBase, viewport.scrollOffset, viewport.scale, viewport.viewportWidth]);

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

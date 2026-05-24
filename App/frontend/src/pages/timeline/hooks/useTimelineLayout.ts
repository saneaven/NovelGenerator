import { useCallback, useMemo, useRef, useState } from 'react';
import type { CalendarConfig } from '../../../types/timeline';
import { toBaseUnits } from '../../../utils/timelineCalendar';
import type { TimelineTrack } from '../../../types/timeline';

export interface TimelineViewport {
  /** Base-units per pixel. Lower = more zoomed in. */
  scale: number;
  /** Leftmost visible base-unit position. */
  scrollOffset: number;
  /** Container width in pixels. */
  viewportWidth: number;
  /**
   * Increments whenever a zoom action wants the DOM scrollLeft re-anchored.
   * TimelineBody applies scrollOffset/scale to the canvas when this changes.
   */
  zoomVersion: number;
}

/** Discrete zoom levels: each represents approx base-units per pixel at that step. */
const ZOOM_STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const DEFAULT_ZOOM_INDEX = 6; // scale=5

function collectAllPositions(tracks: TimelineTrack[], calendar: CalendarConfig): number[] {
  const positions: number[] = [];
  for (const track of tracks) {
    for (const event of track.events) {
      positions.push(toBaseUnits(event.startDate, calendar));
      if (event.endDate) {
        positions.push(toBaseUnits(event.endDate, calendar));
      }
    }
    if (track.children.length > 0) {
      positions.push(...collectAllPositions(track.children, calendar));
    }
  }
  return positions;
}

export function useTimelineLayout(calendar: CalendarConfig, tracks: TimelineTrack[]) {
  const [viewport, setViewport] = useState<TimelineViewport>({
    scale: ZOOM_STEPS[DEFAULT_ZOOM_INDEX],
    scrollOffset: 0,
    viewportWidth: 800,
    zoomVersion: 0,
  });
  const zoomIndexRef = useRef(DEFAULT_ZOOM_INDEX);

  /** Largest base-unit position across all events; drives content width. */
  const contentMaxBase = useMemo(() => {
    const positions = collectAllPositions(tracks, calendar);
    return positions.length > 0 ? Math.max(0, ...positions) : 0;
  }, [tracks, calendar]);

  const setViewportWidth = useCallback((width: number) => {
    setViewport((prev) => (prev.viewportWidth === width ? prev : { ...prev, viewportWidth: width }));
  }, []);

  const setScrollOffset = useCallback((offset: number) => {
    setViewport((prev) => (prev.scrollOffset === offset ? prev : { ...prev, scrollOffset: offset }));
  }, []);

  const zoomIn = useCallback(() => {
    const nextIndex = Math.max(0, zoomIndexRef.current - 1);
    if (nextIndex === zoomIndexRef.current) return;
    zoomIndexRef.current = nextIndex;
    setViewport((prev) => {
      const newScale = ZOOM_STEPS[nextIndex];
      // Keep center of viewport stable
      const center = prev.scrollOffset + (prev.viewportWidth * prev.scale) / 2;
      const newOffset = center - (prev.viewportWidth * newScale) / 2;
      return { ...prev, scale: newScale, scrollOffset: Math.max(0, newOffset), zoomVersion: prev.zoomVersion + 1 };
    });
  }, []);

  const zoomOut = useCallback(() => {
    const nextIndex = Math.min(ZOOM_STEPS.length - 1, zoomIndexRef.current + 1);
    if (nextIndex === zoomIndexRef.current) return;
    zoomIndexRef.current = nextIndex;
    setViewport((prev) => {
      const newScale = ZOOM_STEPS[nextIndex];
      const center = prev.scrollOffset + (prev.viewportWidth * prev.scale) / 2;
      const newOffset = center - (prev.viewportWidth * newScale) / 2;
      return { ...prev, scale: newScale, scrollOffset: Math.max(0, newOffset), zoomVersion: prev.zoomVersion + 1 };
    });
  }, []);

  const zoomAtPoint = useCallback((direction: 'in' | 'out', pixelX: number) => {
    const nextIndex = direction === 'in'
      ? Math.max(0, zoomIndexRef.current - 1)
      : Math.min(ZOOM_STEPS.length - 1, zoomIndexRef.current + 1);
    if (nextIndex === zoomIndexRef.current) return;
    zoomIndexRef.current = nextIndex;
    setViewport((prev) => {
      const newScale = ZOOM_STEPS[nextIndex];
      // Keep the point under the cursor stable
      const pointInBaseUnits = prev.scrollOffset + pixelX * prev.scale;
      const newOffset = pointInBaseUnits - pixelX * newScale;
      return { ...prev, scale: newScale, scrollOffset: Math.max(0, newOffset), zoomVersion: prev.zoomVersion + 1 };
    });
  }, []);

  const fitAll = useCallback(() => {
    const positions = collectAllPositions(tracks, calendar);
    if (positions.length === 0) return;

    const minPos = Math.min(...positions);
    const maxPos = Math.max(...positions);
    const range = maxPos - minPos;

    setViewport((prev) => {
      const padding = prev.viewportWidth * 0.05; // 5% padding each side
      const availableWidth = prev.viewportWidth - padding * 2;
      if (availableWidth <= 0) return prev;

      const newScale = range > 0 ? range / availableWidth : ZOOM_STEPS[DEFAULT_ZOOM_INDEX];
      // Find closest zoom step
      let closest = 0;
      for (let i = 0; i < ZOOM_STEPS.length; i++) {
        if (Math.abs(ZOOM_STEPS[i] - newScale) < Math.abs(ZOOM_STEPS[closest] - newScale)) {
          closest = i;
        }
      }
      zoomIndexRef.current = closest;
      const finalScale = ZOOM_STEPS[closest];
      const newOffset = minPos - padding * finalScale;
      return { ...prev, scale: finalScale, scrollOffset: Math.max(0, newOffset), zoomVersion: prev.zoomVersion + 1 };
    });
  }, [tracks, calendar]);

  /** Human-readable label for current zoom level. */
  const zoomLabel = (() => {
    const s = viewport.scale;
    if (s <= 0.1) return 'Hour';
    if (s <= 1) return 'Day';
    if (s <= 10) return 'Month';
    if (s <= 100) return 'Year';
    return 'Era';
  })();

  return {
    viewport,
    contentMaxBase,
    zoomLabel,
    zoomIn,
    zoomOut,
    zoomAtPoint,
    fitAll,
    setViewportWidth,
    setScrollOffset,
  };
}

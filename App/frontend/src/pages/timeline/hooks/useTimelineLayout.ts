import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/** Empty gutter kept on each side of the content, as a fraction of viewport width (at the fitted view). */
const EDGE_MARGIN_FRAC = 0.06;
/** Smallest scale (most zoomed in). */
const MIN_SCALE = 0.02;
/** Multiplicative step per zoom action — continuous zoom. */
const ZOOM_FACTOR = 1.2;
/** Fallback scale when content has no span (single event / empty). */
const DEFAULT_SCALE = 5;

/**
 * Base-unit gutter that renders as EDGE_MARGIN_FRAC of the viewport at the fitted scale.
 * The viewport width cancels out, so this depends only on the content range and is
 * therefore stable across resizes (which matters: originBase must not move mid-session).
 */
function gutterFor(range: number): number {
  return range > 0 ? range * (EDGE_MARGIN_FRAC / (1 - EDGE_MARGIN_FRAC * 2)) : 0;
}

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

/**
 * Scale + left-edge offset that fits all positions within the viewport with a symmetric
 * edge margin on each side. Returns null when there is nothing to fit or the viewport has
 * not been measured yet. For a fitted multi-event range the returned scrollOffset equals
 * originBase, so the clamp leaves it untouched.
 */
function computeFit(positions: number[], viewportWidth: number): { scale: number; scrollOffset: number } | null {
  if (positions.length === 0 || viewportWidth <= 0) return null;
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);
  const range = maxPos - minPos;
  const marginPx = viewportWidth * EDGE_MARGIN_FRAC;
  const available = viewportWidth - marginPx * 2;
  if (available <= 0) return null;
  const scale = Math.max(MIN_SCALE, range > 0 ? range / available : DEFAULT_SCALE);
  return { scale, scrollOffset: minPos - marginPx * scale };
}

/** Scale at which the whole content + edge margins exactly fill the viewport (max zoom-out). */
function maxZoomScale(range: number, viewportWidth: number): number {
  const available = viewportWidth * (1 - EDGE_MARGIN_FRAC * 2);
  if (available <= 0 || range <= 0) return DEFAULT_SCALE;
  return Math.max(MIN_SCALE, range / available);
}

/**
 * Clamp a desired left-edge base offset so the content stays within one edge gutter on each
 * side. Native scrollLeft can't go below 0, so the left gutter lives in originBase (pixel 0);
 * the left bound here is therefore originBase itself, and the right bound mirrors it.
 */
function clampOffset(
  desired: number,
  scale: number,
  originBase: number,
  contentMaxBase: number,
  gutterBase: number,
  viewportWidth: number,
): number {
  const viewportSpan = viewportWidth * scale;
  const lo = originBase;
  const hi = Math.max(lo, contentMaxBase + gutterBase - viewportSpan);
  return Math.min(hi, Math.max(lo, desired));
}

export function useTimelineLayout(calendar: CalendarConfig, tracks: TimelineTrack[]) {
  const [viewport, setViewport] = useState<TimelineViewport>({
    scale: DEFAULT_SCALE,
    scrollOffset: 0,
    // 0 until the ResizeObserver reports the real width — the initial fit waits for it.
    viewportWidth: 0,
    zoomVersion: 0,
  });
  const initedRef = useRef(false);

  /** Earliest / latest base-unit positions across all events. */
  const { contentMinBase, contentMaxBase } = useMemo(() => {
    const positions = collectAllPositions(tracks, calendar);
    if (positions.length === 0) return { contentMinBase: 0, contentMaxBase: 0 };
    return { contentMinBase: Math.min(...positions), contentMaxBase: Math.max(...positions) };
  }, [tracks, calendar]);

  /** Base-unit gutter (left == right). Derived once from the content range. */
  const gutterBase = gutterFor(contentMaxBase - contentMinBase);

  /**
   * Base value mapped to canvas pixel 0. Sits one gutter before the earliest event so the
   * left gutter exists in native-scroll space (scrollLeft >= 0). Stable across resizes.
   */
  const originBase = contentMinBase - gutterBase;

  /**
   * Fit all content into view once, after the viewport width is measured. Runs in a layout
   * effect so the first painted frame is already fitted (no flash at the default scale).
   */
  useLayoutEffect(() => {
    if (initedRef.current || viewport.viewportWidth <= 0) return;
    const positions = collectAllPositions(tracks, calendar);
    const fit = computeFit(positions, viewport.viewportWidth);
    if (!fit) return;
    initedRef.current = true;
    setViewport((prev) => ({
      ...prev,
      scale: fit.scale,
      scrollOffset: clampOffset(fit.scrollOffset, fit.scale, originBase, contentMaxBase, gutterBase, prev.viewportWidth),
      zoomVersion: prev.zoomVersion + 1,
    }));
  }, [tracks, calendar, viewport.viewportWidth, originBase, contentMaxBase, gutterBase]);

  const setViewportWidth = useCallback((width: number) => {
    setViewport((prev) => (prev.viewportWidth === width ? prev : { ...prev, viewportWidth: width }));
  }, []);

  const setScrollOffset = useCallback((offset: number) => {
    setViewport((prev) => (prev.scrollOffset === offset ? prev : { ...prev, scrollOffset: offset }));
  }, []);

  const zoomIn = useCallback(() => {
    setViewport((prev) => {
      const maxScale = maxZoomScale(contentMaxBase - contentMinBase, prev.viewportWidth);
      const newScale = Math.max(MIN_SCALE, Math.min(maxScale, prev.scale / ZOOM_FACTOR));
      if (newScale === prev.scale) return prev;
      // Keep center of viewport stable
      const center = prev.scrollOffset + (prev.viewportWidth * prev.scale) / 2;
      const newOffset = center - (prev.viewportWidth * newScale) / 2;
      return {
        ...prev,
        scale: newScale,
        scrollOffset: clampOffset(newOffset, newScale, originBase, contentMaxBase, gutterBase, prev.viewportWidth),
        zoomVersion: prev.zoomVersion + 1,
      };
    });
  }, [originBase, contentMinBase, contentMaxBase, gutterBase]);

  const zoomOut = useCallback(() => {
    setViewport((prev) => {
      const maxScale = maxZoomScale(contentMaxBase - contentMinBase, prev.viewportWidth);
      const newScale = Math.max(MIN_SCALE, Math.min(maxScale, prev.scale * ZOOM_FACTOR));
      if (newScale === prev.scale) return prev;
      const center = prev.scrollOffset + (prev.viewportWidth * prev.scale) / 2;
      const newOffset = center - (prev.viewportWidth * newScale) / 2;
      return {
        ...prev,
        scale: newScale,
        scrollOffset: clampOffset(newOffset, newScale, originBase, contentMaxBase, gutterBase, prev.viewportWidth),
        zoomVersion: prev.zoomVersion + 1,
      };
    });
  }, [originBase, contentMinBase, contentMaxBase, gutterBase]);

  const zoomAtPoint = useCallback((direction: 'in' | 'out', pixelX: number) => {
    setViewport((prev) => {
      const maxScale = maxZoomScale(contentMaxBase - contentMinBase, prev.viewportWidth);
      const factor = direction === 'in' ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
      const newScale = Math.max(MIN_SCALE, Math.min(maxScale, prev.scale * factor));
      if (newScale === prev.scale) return prev;
      // Keep the point under the cursor stable
      const pointInBaseUnits = prev.scrollOffset + pixelX * prev.scale;
      const newOffset = pointInBaseUnits - pixelX * newScale;
      return {
        ...prev,
        scale: newScale,
        scrollOffset: clampOffset(newOffset, newScale, originBase, contentMaxBase, gutterBase, prev.viewportWidth),
        zoomVersion: prev.zoomVersion + 1,
      };
    });
  }, [originBase, contentMinBase, contentMaxBase, gutterBase]);

  const fitAll = useCallback(() => {
    const positions = collectAllPositions(tracks, calendar);
    if (positions.length === 0) return;
    setViewport((prev) => {
      const fit = computeFit(positions, prev.viewportWidth);
      if (!fit) return prev;
      return {
        ...prev,
        scale: fit.scale,
        scrollOffset: clampOffset(fit.scrollOffset, fit.scale, originBase, contentMaxBase, gutterBase, prev.viewportWidth),
        zoomVersion: prev.zoomVersion + 1,
      };
    });
  }, [tracks, calendar, originBase, contentMaxBase, gutterBase]);

  /** Human-readable label for current zoom level. */
  const zoomLabel = (() => {
    const s = viewport.scale;
    if (s <= 0.1) return 'Minute';
    if (s <= 1) return 'Day';
    if (s <= 10) return 'Month';
    if (s <= 100) return 'Year';
    return 'Era';
  })();

  return {
    viewport,
    originBase,
    contentMaxBase,
    gutterBase,
    zoomLabel,
    zoomIn,
    zoomOut,
    zoomAtPoint,
    fitAll,
    setViewportWidth,
    setScrollOffset,
  };
}

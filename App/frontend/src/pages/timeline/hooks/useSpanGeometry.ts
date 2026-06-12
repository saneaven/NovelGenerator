import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TimelineLayout } from '../layout/types';

export interface BreakSegment {
  topPx: number;
  bottomPx: number;
}

export interface SpanGeometryItem {
  eventId: string;
  lane: number;
  colorKey: string;
  name: string;
  topPx: number;
  bottomPx: number;
  /** measured extents of break rows the span crosses → dashed rendering */
  breakSegments: BreakSegment[];
}

interface SpanGeometryApi {
  /** attach to the rows wrapper (position: relative) */
  wrapperRef: React.RefObject<HTMLOListElement | null>;
  /**
   * Rows register their measurement element here: anchor rows register their
   * spine NODE dot (rail endpoints), break rows register their root element.
   */
  registerRowElement: (key: string, el: HTMLElement | null) => void;
  geometries: SpanGeometryItem[];
  /** cached top offset (px, within the wrapper) of every registered row key — drives scroll logic */
  rowTops: ReadonlyMap<string, number>;
  /** fresh single-row measurement — use where the cached map may lag a layout change */
  getRowTop: (key: string) => number | undefined;
  /** force a synchronous re-measure (e.g. after an expand animation settles) */
  requestMeasure: () => void;
}

function geometriesEqual(a: SpanGeometryItem[], b: SpanGeometryItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.eventId !== y.eventId || x.lane !== y.lane || x.topPx !== y.topPx || x.bottomPx !== y.bottomPx) return false;
    if (x.breakSegments.length !== y.breakSegments.length) return false;
    for (let j = 0; j < x.breakSegments.length; j += 1) {
      if (x.breakSegments[j].topPx !== y.breakSegments[j].topPx || x.breakSegments[j].bottomPx !== y.breakSegments[j].bottomPx) return false;
    }
  }
  return true;
}

export function useSpanGeometry(layout: TimelineLayout): SpanGeometryApi {
  const wrapperRef = useRef<HTMLOListElement | null>(null);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const frameRef = useRef<number | null>(null);
  const [geometries, setGeometries] = useState<SpanGeometryItem[]>([]);
  const [rowTops, setRowTops] = useState<ReadonlyMap<string, number>>(new Map());

  // break keys crossed per laned span, in row order
  const breaksByEventId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of layout.rows) {
      if (row.kind !== 'break') continue;
      for (const eventId of row.crossingEventIds) {
        const list = map.get(eventId);
        if (list) list.push(row.key);
        else map.set(eventId, [row.key]);
      }
    }
    return map;
  }, [layout]);

  const measure = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const elements = elementsRef.current;

    const tops = new Map<string, number>();
    for (const [key, el] of elements) {
      tops.set(key, el.getBoundingClientRect().top - wrapperRect.top);
    }

    const next: SpanGeometryItem[] = [];
    for (const span of layout.spans) {
      const startEl = elements.get(span.startRowKey);
      const endEl = elements.get(span.endRowKey);
      if (!startEl || !endEl) continue;
      const startRect = startEl.getBoundingClientRect();
      const endRect = endEl.getBoundingClientRect();
      const topPx = startRect.top + startRect.height / 2 - wrapperRect.top;
      const bottomPx = endRect.top + endRect.height / 2 - wrapperRect.top;
      const breakSegments: BreakSegment[] = [];
      for (const breakKey of breaksByEventId.get(span.eventId) ?? []) {
        const breakEl = elements.get(breakKey);
        if (!breakEl) continue;
        const rect = breakEl.getBoundingClientRect();
        breakSegments.push({ topPx: rect.top - wrapperRect.top, bottomPx: rect.bottom - wrapperRect.top });
      }
      next.push({
        eventId: span.eventId,
        lane: span.lane,
        colorKey: span.colorKey,
        name: span.name,
        topPx,
        bottomPx,
        breakSegments,
      });
    }

    setGeometries((prev) => (geometriesEqual(prev, next) ? prev : next));
    setRowTops((prev) => {
      if (prev.size === tops.size) {
        let same = true;
        for (const [key, value] of tops) {
          if (prev.get(key) !== value) { same = false; break; }
        }
        if (same) return prev;
      }
      return tops;
    });
  }, [layout, breaksByEventId]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  const registerRowElement = useCallback((key: string, el: HTMLElement | null) => {
    if (el) elementsRef.current.set(key, el);
    else elementsRef.current.delete(key);
  }, []);

  const getRowTop = useCallback((key: string): number | undefined => {
    const wrapper = wrapperRef.current;
    const el = elementsRef.current.get(key);
    if (!wrapper || !el) return undefined;
    return el.getBoundingClientRect().top - wrapper.getBoundingClientRect().top;
  }, []);

  // re-measure synchronously after every layout change (rows added/removed/reordered)
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // one observer on the wrapper: any row height change changes the wrapper height
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(wrapper);
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scheduleMeasure]);

  return { wrapperRef, registerRowElement, geometries, rowTops, getRowTop, requestMeasure: measure };
}

export default useSpanGeometry;

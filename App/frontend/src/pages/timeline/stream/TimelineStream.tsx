import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ObjectPickerItem } from '../../../components/ObjectPicker/types';
import type { CalendarConfig, TimelineDate, TimelineEventLink } from '../../../types/timeline';
import type { TimelineLayout, VisibleEvent } from '../layout/types';
import { useSpanGeometry } from '../hooks/useSpanGeometry';
import AnchorRow from './AnchorRow';
import BreakSeparator from './BreakSeparator';
import SpanRail from './SpanRail';
import StickyPeriodPill from './StickyPeriodPill';
import { stickyPeriodLabel } from './streamText';
import './TimelineStream.css';

export interface TimelineStreamHandle {
  /** scroll an event's anchor to ~30% viewport, expand its card and flash it */
  scrollToEvent: (eventId: string) => void;
  scrollToStart: () => void;
  scrollToEnd: () => void;
  /** scroll to the first anchor at or after a base position */
  scrollToBase: (base: number) => void;
}

interface TimelineStreamProps {
  layout: TimelineLayout;
  calendar: CalendarConfig;
  collapseAt: number;
  linkItems: ReadonlyMap<string, ObjectPickerItem>;
  onEditEvent: (ve: VisibleEvent) => void;
  onDeleteEvent: (ve: VisibleEvent) => void;
  onQuickAdd: (date: TimelineDate) => void;
  onTagClick: (tag: string) => void;
  onNavigateLink: (link: TimelineEventLink) => void;
}

const FLASH_MS = 2000;
const CONTENT_VISIBILITY_THRESHOLD = 300;

const TimelineStream = forwardRef<TimelineStreamHandle, TimelineStreamProps>(({
  layout,
  calendar,
  collapseAt,
  linkItems,
  onEditEvent,
  onDeleteEvent,
  onQuickAdd,
  onTagClick,
  onNavigateLink,
}, ref) => {
  const streamRef = useRef<HTMLDivElement | null>(null);
  const { wrapperRef, registerRowElement, geometries, rowTops, getRowTop, requestMeasure } = useSpanGeometry(layout);

  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(() => new Set());
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);
  const [topRowKey, setTopRowKey] = useState<string | null>(null);

  const animationCounter = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAnchorRef = useRef<{ key: string; offset: number } | null>(null);
  const scrollFrame = useRef<number | null>(null);

  // prune state that refers to rows/events that no longer exist
  useEffect(() => {
    if (expandedEventId && !layout.eventById.has(expandedEventId)) setExpandedEventId(null);
    setExpandedClusters((prev) => {
      const valid = new Set(layout.rows.filter((r) => r.kind === 'anchor').map((r) => r.key));
      const next = new Set([...prev].filter((key) => valid.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [layout, expandedEventId]);

  const handleAnimationStateChange = useCallback((isAnimating: boolean) => {
    animationCounter.current += isAnimating ? 1 : -1;
    if (animationCounter.current < 0) animationCounter.current = 0;
    const active = animationCounter.current > 0;
    setAnimating(active);
    if (!active) requestMeasure();
  }, [requestMeasure]);

  const handleToggleEvent = useCallback((eventId: string) => {
    setExpandedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  const handleExpandCluster = useCallback((anchorKey: string) => {
    setExpandedClusters((prev) => new Set(prev).add(anchorKey));
  }, []);

  // ----- scroll position bookkeeping (sticky pill + preservation across layout changes)

  const orderedRowKeys = useMemo(() => layout.rows.map((row) => row.key), [layout]);

  const wrapperOffsetTop = useCallback(() => {
    const wrapper = wrapperRef.current;
    return wrapper ? wrapper.offsetTop : 0;
  }, [wrapperRef]);

  const captureScrollAnchor = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const scrollTop = stream.scrollTop - wrapperOffsetTop();
    let current: { key: string; offset: number } | null = null;
    for (const key of orderedRowKeys) {
      const top = rowTops.get(key);
      if (top === undefined) continue;
      if (top <= scrollTop + 1) current = { key, offset: top - scrollTop };
      else break;
    }
    scrollAnchorRef.current = current ?? (orderedRowKeys.length > 0 ? { key: orderedRowKeys[0], offset: 0 } : null);
    setTopRowKey(current?.key ?? orderedRowKeys[0] ?? null);
  }, [orderedRowKeys, rowTops, wrapperOffsetTop]);

  const handleScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      captureScrollAnchor();
    });
  }, [captureScrollAnchor]);

  // restore the previously topmost row after the layout (row set) changes
  const lastRowsRef = useRef(layout.rows);
  useLayoutEffect(() => {
    if (lastRowsRef.current === layout.rows) return;
    lastRowsRef.current = layout.rows;
    const stream = streamRef.current;
    const anchor = scrollAnchorRef.current;
    if (!stream || !anchor) return;
    const top = getRowTop(anchor.key); // fresh measurement — the cached map may lag this commit
    if (top === undefined) return; // row vanished — keep the browser-clamped position
    stream.scrollTop = wrapperOffsetTop() + top - anchor.offset;
  }, [layout.rows, getRowTop, wrapperOffsetTop]);

  // keep the pill in sync when row tops settle (initial measure, expansions)
  useEffect(() => {
    captureScrollAnchor();
  }, [rowTops, captureScrollAnchor]);

  // ----- jumping

  const scrollRowIntoView = useCallback((rowKey: string) => {
    const stream = streamRef.current;
    const top = getRowTop(rowKey);
    if (!stream || top === undefined) return;
    stream.scrollTo({
      top: Math.max(wrapperOffsetTop() + top - stream.clientHeight * 0.3, 0),
      behavior: 'smooth',
    });
  }, [getRowTop, wrapperOffsetTop]);

  const jumpToEvent = useCallback((eventId: string) => {
    const rowIndex = layout.rowIndexByEventId.get(eventId);
    if (rowIndex === undefined) return;
    const row = layout.rows[rowIndex];
    if (row.kind !== 'anchor') return;
    // reveal collapsed cluster members before scrolling
    const position = row.starts.findIndex((ve) => ve.event.id === eventId);
    if (row.starts.length > collapseAt && position >= collapseAt - 1) {
      setExpandedClusters((prev) => new Set(prev).add(row.key));
    }
    setExpandedEventId(eventId);
    setHighlightedEventId(eventId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setHighlightedEventId(null), FLASH_MS);
    // let the cluster/card render before measuring the destination
    requestAnimationFrame(() => scrollRowIntoView(row.key));
  }, [layout, collapseAt, scrollRowIntoView]);

  useImperativeHandle(ref, () => ({
    scrollToEvent: jumpToEvent,
    scrollToStart: () => streamRef.current?.scrollTo({ top: 0, behavior: 'smooth' }),
    scrollToEnd: () => {
      const stream = streamRef.current;
      if (stream) stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' });
    },
    scrollToBase: (base: number) => {
      const row = layout.rows.find((r) => r.kind === 'anchor' && r.base >= base);
      if (row) scrollRowIntoView(row.key);
      else streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
    },
  }), [jumpToEvent, layout, scrollRowIntoView]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
  }, []);

  // ----- sticky pill label

  const pillLabel = useMemo(() => {
    if (!topRowKey) return null;
    const index = layout.rows.findIndex((row) => row.key === topRowKey);
    if (index === -1) return null;
    for (let i = index; i >= 0; i -= 1) {
      const row = layout.rows[i];
      if (row.kind === 'anchor') return stickyPeriodLabel(row.date, row.labelRank, calendar);
    }
    const firstAnchor = layout.rows.find((row) => row.kind === 'anchor');
    return firstAnchor && firstAnchor.kind === 'anchor'
      ? stickyPeriodLabel(firstAnchor.date, firstAnchor.labelRank, calendar)
      : null;
  }, [topRowKey, layout, calendar]);

  const useContentVisibility = layout.rows.length > CONTENT_VISIBILITY_THRESHOLD;

  return (
    <div className="tl-stream" ref={streamRef} onScroll={handleScroll}>
      <StickyPeriodPill label={pillLabel} />
      <ol
        ref={wrapperRef}
        className={`tl-stream__rows ${useContentVisibility ? 'tl-stream__rows--cv' : ''}`}
        style={{ '--tl-lanes': layout.laneCount } as React.CSSProperties}
        aria-label="Timeline"
      >
        {layout.rows.map((row) => (
          row.kind === 'anchor' ? (
            <AnchorRow
              key={row.key}
              row={row}
              calendar={calendar}
              collapseAt={collapseAt}
              clusterExpanded={expandedClusters.has(row.key)}
              expandedEventId={expandedEventId}
              highlightedEventId={highlightedEventId}
              overflowSpans={layout.overflowAtAnchor.get(row.key)}
              linkItems={linkItems}
              registerRowElement={registerRowElement}
              onExpandCluster={handleExpandCluster}
              onToggleEvent={handleToggleEvent}
              onEditEvent={onEditEvent}
              onDeleteEvent={onDeleteEvent}
              onTagClick={onTagClick}
              onNavigateLink={onNavigateLink}
              onQuickAdd={onQuickAdd}
              onJumpToEvent={jumpToEvent}
              onAnimationStateChange={handleAnimationStateChange}
            />
          ) : (
            <BreakSeparator
              key={row.key}
              row={row}
              calendar={calendar}
              registerRowElement={registerRowElement}
              onJumpToEvent={jumpToEvent}
            />
          )
        ))}
        <SpanRail geometries={geometries} dimmed={animating} onJumpToEvent={jumpToEvent} />
      </ol>
    </div>
  );
});

TimelineStream.displayName = 'TimelineStream';

export default TimelineStream;

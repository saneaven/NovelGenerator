import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { TimelineTrack, TimelineEvent } from '../../../types/timeline';
import type { RulerTick } from '../hooks/useTimelinePositioning';
import TimelineRuler from './TimelineRuler';
import './TimelineBody.css';

interface TimelineBodyProps {
  tracks: TimelineTrack[];
  expandedTracks: Set<string>;
  selectedEventId: string | null;
  displayLanguage: string;
  canvasWidth: number;
  rulerTicks: RulerTick[];
  scrollOffset: number;
  originBase: number;
  scale: number;
  zoomVersion: number;
  onToggleExpand: (trackId: string) => void;
  onEditTrack: (track: TimelineTrack) => void;
  onAddSubTrack: (parentTrack: TimelineTrack) => void;
  onAddEvent: (track: TimelineTrack) => void;
  onDeleteTrack: (track: TimelineTrack) => void;
  onSelectEvent: (event: TimelineEvent) => void;
  onLaneDoubleClick: (track: TimelineTrack, pixelX: number) => void;
  onScroll: (scrollLeft: number) => void;
  onSetViewportWidth: (width: number) => void;
  eventLeft: (event: TimelineEvent) => number;
  eventWidth: (event: TimelineEvent) => number | null;
  onWheel: (e: React.WheelEvent, pixelX: number) => void;
}

const TimelineBody: React.FC<TimelineBodyProps> = ({
  tracks,
  expandedTracks,
  selectedEventId,
  displayLanguage,
  canvasWidth,
  rulerTicks,
  scrollOffset,
  originBase,
  scale,
  zoomVersion,
  onToggleExpand,
  onEditTrack,
  onAddSubTrack,
  onAddEvent,
  onDeleteTrack,
  onSelectEvent,
  onLaneDoubleClick,
  onScroll,
  onSetViewportWidth,
  eventLeft,
  eventWidth,
  onWheel,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  // Measure viewport width
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onSetViewportWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onSetViewportWidth]);

  // Re-anchor native scroll position after a zoom action. scrollOffset is the
  // desired left-edge base position; convert to pixels for the current scale and
  // clamp into the scrollable range so a stale/over-range target can't cause a jump.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const targetLeft = Math.min(maxLeft, Math.max(0, (scrollOffset - originBase) / scale));
    el.scrollLeft = targetLeft;
    if (rulerRef.current) {
      rulerRef.current.scrollLeft = targetLeft;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomVersion]);

  // Sync scroll
  const handleScroll = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    if (rulerRef.current) {
      rulerRef.current.scrollLeft = el.scrollLeft;
    }
    if (labelsRef.current) {
      labelsRef.current.scrollTop = el.scrollTop;
    }
    onScroll(el.scrollLeft);
  }, [onScroll]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        const pixelX = rect ? e.clientX - rect.left : 0;
        onWheel(e, pixelX);
      }
    },
    [onWheel],
  );

  return (
    <div className="timeline-body">
      {/* Top-left corner */}
      <div className="timeline-body__corner">
        <span className="timeline-body__corner-label">Tracks</span>
      </div>

      {/* Ruler (scrolls horizontally, synced) */}
      <div className="timeline-body__ruler" ref={rulerRef}>
        <TimelineRuler ticks={rulerTicks} canvasWidth={canvasWidth} />
      </div>

      {/* Track labels (scrolls vertically, synced) */}
      <div className="timeline-body__labels" ref={labelsRef}>
        {tracks.map((track) => (
          <TimelineTrackLabelColumn
            key={track.id}
            track={track}
            depth={0}
            expandedTracks={expandedTracks}
            displayLanguage={displayLanguage}
            onToggleExpand={onToggleExpand}
            onEditTrack={onEditTrack}
            onAddSubTrack={onAddSubTrack}
            onAddEvent={onAddEvent}
            onDeleteTrack={onDeleteTrack}
          />
        ))}
      </div>

      {/* Canvas: scrolls both H and V */}
      <div
        className="timeline-body__canvas"
        ref={canvasRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        <div className="timeline-body__canvas-inner" style={{ width: canvasWidth }}>
          {tracks.map((track) => (
            <TimelineTrackLaneColumn
              key={track.id}
              track={track}
              depth={0}
              expandedTracks={expandedTracks}
              selectedEventId={selectedEventId}
              displayLanguage={displayLanguage}
              canvasWidth={canvasWidth}
              onSelectEvent={onSelectEvent}
              onLaneDoubleClick={onLaneDoubleClick}
              eventLeft={eventLeft}
              eventWidth={eventWidth}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

/* --- Helper: renders just the label side of tracks recursively --- */
interface LabelColumnProps {
  track: TimelineTrack;
  depth: number;
  expandedTracks: Set<string>;
  displayLanguage: string;
  onToggleExpand: (trackId: string) => void;
  onEditTrack: (track: TimelineTrack) => void;
  onAddSubTrack: (parentTrack: TimelineTrack) => void;
  onAddEvent: (track: TimelineTrack) => void;
  onDeleteTrack: (track: TimelineTrack) => void;
}

import TimelineTrackLabel from './TimelineTrackLabel';
import { getTrackColors } from '../timelineColors';

const TimelineTrackLabelColumn: React.FC<LabelColumnProps> = ({
  track,
  depth,
  expandedTracks,
  displayLanguage,
  onToggleExpand,
  onEditTrack,
  onAddSubTrack,
  onAddEvent,
  onDeleteTrack,
}) => {
  const colors = getTrackColors(track.color);
  const hasChildren = track.children.length > 0;
  const isExpanded = expandedTracks.has(track.id);
  const isLeaf = !hasChildren;

  return (
    <>
      <div className={`timeline-body__label-row${isLeaf ? '' : ' timeline-body__label-row--parent'}`}>
        <TimelineTrackLabel
          track={track}
          colors={colors}
          depth={depth}
          isExpanded={isExpanded}
          hasChildren={hasChildren}
          displayLanguage={displayLanguage}
          onToggleExpand={() => onToggleExpand(track.id)}
          onEditTrack={onEditTrack}
          onAddSubTrack={onAddSubTrack}
          onAddEvent={onAddEvent}
          onDeleteTrack={onDeleteTrack}
        />
      </div>
      {hasChildren && isExpanded &&
        track.children.map((child) => (
          <TimelineTrackLabelColumn
            key={child.id}
            track={child}
            depth={depth + 1}
            expandedTracks={expandedTracks}
            displayLanguage={displayLanguage}
            onToggleExpand={onToggleExpand}
            onEditTrack={onEditTrack}
            onAddSubTrack={onAddSubTrack}
            onAddEvent={onAddEvent}
            onDeleteTrack={onDeleteTrack}
          />
        ))}
    </>
  );
};

/* --- Helper: renders just the lane side of tracks recursively --- */
interface LaneColumnProps {
  track: TimelineTrack;
  depth: number;
  expandedTracks: Set<string>;
  selectedEventId: string | null;
  displayLanguage: string;
  canvasWidth: number;
  onSelectEvent: (event: TimelineEvent) => void;
  onLaneDoubleClick: (track: TimelineTrack, pixelX: number) => void;
  eventLeft: (event: TimelineEvent) => number;
  eventWidth: (event: TimelineEvent) => number | null;
}

const TimelineTrackLaneColumn: React.FC<LaneColumnProps> = ({
  track,
  depth,
  expandedTracks,
  selectedEventId,
  displayLanguage,
  canvasWidth,
  onSelectEvent,
  onLaneDoubleClick,
  eventLeft,
  eventWidth,
}) => {
  const colors = getTrackColors(track.color);
  const hasChildren = track.children.length > 0;
  const isExpanded = expandedTracks.has(track.id);
  const isLeaf = !hasChildren;

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isLeaf) return;
      const rect = e.currentTarget.getBoundingClientRect();
      onLaneDoubleClick(track, e.clientX - rect.left);
    },
    [isLeaf, track, onLaneDoubleClick],
  );

  return (
    <>
      <div
        className={`timeline-body__lane-row${isLeaf ? '' : ' timeline-body__lane-row--parent'}`}
        style={{ background: colors.rowTint }}
        onDoubleClick={handleDoubleClick}
      >
        {isLeaf && track.events.length === 0 && (
          <span className="timeline-body__lane-empty">Double-click to add event</span>
        )}
        {isLeaf &&
          track.events.map((event) => {
            const left = eventLeft(event);
            const width = eventWidth(event);
            if (width !== null) {
              return (
                <TimelineEventBar
                  key={event.id}
                  event={event}
                  left={left}
                  width={width}
                  colors={colors}
                  isSelected={selectedEventId === event.id}
                  displayLanguage={displayLanguage}
                  onClick={onSelectEvent}
                />
              );
            }
            return (
              <TimelineEventDot
                key={event.id}
                event={event}
                left={left}
                colors={colors}
                isSelected={selectedEventId === event.id}
                displayLanguage={displayLanguage}
                onClick={onSelectEvent}
              />
            );
          })}
      </div>
      {hasChildren && isExpanded &&
        track.children.map((child) => (
          <TimelineTrackLaneColumn
            key={child.id}
            track={child}
            depth={depth + 1}
            expandedTracks={expandedTracks}
            selectedEventId={selectedEventId}
            displayLanguage={displayLanguage}
            canvasWidth={canvasWidth}
            onSelectEvent={onSelectEvent}
            onLaneDoubleClick={onLaneDoubleClick}
            eventLeft={eventLeft}
            eventWidth={eventWidth}
          />
        ))}
    </>
  );
};

import TimelineEventBar from './TimelineEventBar';
import TimelineEventDot from './TimelineEventDot';

export default TimelineBody;

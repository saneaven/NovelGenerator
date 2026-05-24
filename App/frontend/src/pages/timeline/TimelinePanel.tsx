import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTimelineStore } from '../../store/timelineStore';
import { useDisplayLanguageStore } from '../../store/displayLanguageStore';
import { DEFAULT_CALENDAR } from '../../utils/timelineCalendar';
import { useTimelineLayout } from './hooks/useTimelineLayout';
import { useTimelinePositioning } from './hooks/useTimelinePositioning';
import type { TimelineTrack, TimelineEvent, TimelineDate } from '../../types/timeline';

import TimelineEmptyState from './components/TimelineEmptyState';
import TimelineToolbar from './components/TimelineToolbar';
import TimelineBody from './components/TimelineBody';
import TimelineEventSidebar from './components/TimelineEventSidebar';
import TimelineTrackSidebar from './components/TimelineTrackSidebar';
import CalendarConfigModal from './components/CalendarConfigModal';

import './TimelinePanel.css';

interface TimelinePanelProps {
  globalDisplayLanguage: string;
}

const TimelinePanel: React.FC<TimelinePanelProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId ?? '';

  // Store
  const timeline = useTimelineStore((s) => s.timeline);
  const isLoading = useTimelineStore((s) => s.isLoading);
  const fetchTimeline = useTimelineStore((s) => s.fetchTimeline);
  const deleteTrack = useTimelineStore((s) => s.deleteTrack);

  const displayLanguage = useDisplayLanguageStore((s) => s.preferredDisplayLanguage) || globalDisplayLanguage;

  // Fetch timeline on mount
  useEffect(() => {
    if (pid) {
      fetchTimeline(pid, displayLanguage);
    }
  }, [pid, displayLanguage, fetchTimeline]);

  const calendar = timeline?.calendar ?? DEFAULT_CALENDAR;
  const tracks = timeline?.tracks ?? [];

  // Layout & positioning
  const {
    viewport,
    contentMaxBase,
    zoomLabel,
    zoomIn,
    zoomOut,
    zoomAtPoint,
    fitAll,
    setViewportWidth,
    setScrollOffset,
  } = useTimelineLayout(calendar, tracks);

  const {
    eventLeft,
    eventWidth,
    canvasWidth,
    rulerTicks,
    pixelToDate,
  } = useTimelinePositioning(calendar, viewport, contentMaxBase);

  // UI state
  const [expandedTracks, setExpandedTracks] = useState<Set<string>>(() => new Set());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [editingTrack, setEditingTrack] = useState<TimelineTrack | null>(null);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [creatingTrackParentId, setCreatingTrackParentId] = useState<string | null | undefined>(undefined);
  const [creatingEventTrack, setCreatingEventTrack] = useState<{ track: TimelineTrack; date: TimelineDate } | null>(null);
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  // Auto-expand all top-level tracks on first load
  useEffect(() => {
    if (tracks.length > 0 && expandedTracks.size === 0) {
      setExpandedTracks(new Set(tracks.filter((t) => t.children.length > 0).map((t) => t.id)));
    }
  }, [tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find event by id across all tracks
  // Handlers
  const handleToggleExpand = useCallback((trackId: string) => {
    setExpandedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  const handleCreateTrack = useCallback(() => {
    setCreatingTrackParentId(null); // root-level
    setEditingTrack(null);
  }, []);

  const handleAddSubTrack = useCallback((parent: TimelineTrack) => {
    setCreatingTrackParentId(parent.id);
    setEditingTrack(null);
  }, []);

  const handleEditTrack = useCallback((track: TimelineTrack) => {
    setEditingTrack(track);
    setCreatingTrackParentId(undefined);
  }, []);

  const handleDeleteTrack = useCallback(
    async (track: TimelineTrack) => {
      if (!confirm(`Delete track "${(track.data?.[displayLanguage] as Record<string, unknown>)?.name || 'Untitled'}"? All events in it will be deleted.`)) return;
      await deleteTrack(pid, track.id, displayLanguage);
    },
    [pid, displayLanguage, deleteTrack],
  );

  const handleAddEvent = useCallback((track: TimelineTrack) => {
    // Default date: a reasonable start point
    const defaultDate: TimelineDate = {};
    for (const unit of calendar.units) {
      defaultDate[unit.name] = 0;
    }
    setCreatingEventTrack({ track, date: defaultDate });
    setEditingEvent(null);
    setSelectedEventId(null);
  }, [calendar]);

  const handleSelectEvent = useCallback((event: TimelineEvent) => {
    setSelectedEventId(event.id);
    setEditingEvent(event);
    setCreatingEventTrack(null);
  }, []);

  const handleLaneDoubleClick = useCallback(
    (track: TimelineTrack, pixelX: number) => {
      const date = pixelToDate(pixelX);
      setCreatingEventTrack({ track, date });
      setEditingEvent(null);
      setSelectedEventId(null);
    },
    [pixelToDate],
  );

  const handleScroll = useCallback(
    (scrollLeft: number) => {
      setScrollOffset(scrollLeft * viewport.scale);
    },
    [setScrollOffset, viewport.scale],
  );

  const handleWheel = useCallback(
    (_e: React.WheelEvent, pixelX: number) => {
      const direction = _e.deltaY > 0 ? 'out' : 'in';
      zoomAtPoint(direction, pixelX);
    },
    [zoomAtPoint],
  );

  const handleCloseSidebars = useCallback(() => {
    setEditingEvent(null);
    setEditingTrack(null);
    setCreatingTrackParentId(undefined);
    setCreatingEventTrack(null);
    setSelectedEventId(null);
  }, []);

  // Sidebar open state
  const showEventSidebar = editingEvent !== null || creatingEventTrack !== null;
  const showTrackSidebar = editingTrack !== null || creatingTrackParentId !== undefined;

  if (isLoading && !timeline) {
    return (
      <div className="timeline-panel timeline-panel--loading">
        <div className="timeline-panel__loading">Loading timeline...</div>
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="timeline-panel">
        <TimelineEmptyState
          onCreateTrack={handleCreateTrack}
          onConfigureCalendar={() => setShowCalendarModal(true)}
        />
        {showTrackSidebar && (
          <TimelineTrackSidebar
            projectId={pid}
            track={editingTrack}
            parentId={creatingTrackParentId ?? null}
            displayLanguage={displayLanguage}
            onClose={handleCloseSidebars}
          />
        )}
        <CalendarConfigModal
          isOpen={showCalendarModal}
          projectId={pid}
          calendar={calendar}
          displayLanguage={displayLanguage}
          onClose={() => setShowCalendarModal(false)}
        />
      </div>
    );
  }

  return (
    <div className="timeline-panel">
      <TimelineToolbar
        zoomLabel={zoomLabel}
        onCreateTrack={handleCreateTrack}
        onConfigureCalendar={() => setShowCalendarModal(true)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitAll={fitAll}
      />

      <TimelineBody
        tracks={tracks}
        expandedTracks={expandedTracks}
        selectedEventId={selectedEventId}
        displayLanguage={displayLanguage}
        canvasWidth={canvasWidth}
        rulerTicks={rulerTicks}
        scrollOffset={viewport.scrollOffset}
        scale={viewport.scale}
        zoomVersion={viewport.zoomVersion}
        onToggleExpand={handleToggleExpand}
        onEditTrack={handleEditTrack}
        onAddSubTrack={handleAddSubTrack}
        onAddEvent={handleAddEvent}
        onDeleteTrack={handleDeleteTrack}
        onSelectEvent={handleSelectEvent}
        onLaneDoubleClick={handleLaneDoubleClick}
        onScroll={handleScroll}
        onSetViewportWidth={setViewportWidth}
        eventLeft={eventLeft}
        eventWidth={eventWidth}
        onWheel={handleWheel}
      />

      {showEventSidebar && (
        <TimelineEventSidebar
          projectId={pid}
          event={editingEvent}
          createForTrack={creatingEventTrack}
          displayLanguage={displayLanguage}
          calendar={calendar}
          tracks={tracks}
          onClose={handleCloseSidebars}
        />
      )}

      {showTrackSidebar && (
        <TimelineTrackSidebar
          projectId={pid}
          track={editingTrack}
          parentId={creatingTrackParentId ?? null}
          displayLanguage={displayLanguage}
          onClose={handleCloseSidebars}
        />
      )}

      <CalendarConfigModal
        isOpen={showCalendarModal}
        projectId={pid}
        calendar={calendar}
        displayLanguage={displayLanguage}
        onClose={() => setShowCalendarModal(false)}
      />
    </div>
  );
};

export default TimelinePanel;

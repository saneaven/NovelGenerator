import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Close, Warning } from '../../components/icons';
import { useObjectPickerData } from '../../components/ObjectPicker/useObjectPickerData';
import { confirm as confirmDialog } from '../../store/dialogStore';
import { useSelectionStore } from '../../store/selectionStore';
import { useUiStore } from '../../store/uiStore';
import { useObjectCollectionQuery } from '../../data/objects/useObjectCollectionQuery';
import { useTimelineConfig } from '../../data/timeline/useTimelineConfigQuery';
import { deleteEvent } from '../../data/timeline/timelineCommands';
import type { TimelineDate, TimelineEvent, TimelineTrack } from '../../types/timeline';
import type { UnifiedObject } from '../../types/unifiedObject';
import { DEFAULT_CALENDAR } from '../../utils/timelineCalendar';
import { buildTimelineFromObjects } from '../../utils/timelineView';
import { useIsMobile } from './hooks/useIsMobile';
import { useTimelineLayout } from './hooks/useTimelineLayout';
import { DESKTOP_SPACING, MOBILE_SPACING, type VisibleEvent } from './layout/types';
import { resolveEntityText } from './layout/computeTimelineLayout';
import CalendarConfigModal from './modals/CalendarConfigModal';
import EventEditModal, { type EventCreateDefaults } from './modals/EventEditModal';
import { collectLinkItems, filterLinkGroups } from './modals/eventLinkUtils';
import JumpToDateModal from './modals/JumpToDateModal';
import TrackEditModal from './modals/TrackEditModal';
import MoveTrackModal from './sidebar/MoveTrackModal';
import TrackTreePanel from './sidebar/TrackTreePanel';
import TrackTreeSidebar from './sidebar/TrackTreeSidebar';
import TimelineEmptyState, { type EmptyStateKind } from './stream/TimelineEmptyState';
import TimelineFab from './stream/TimelineFab';
import TimelineSkeleton from './stream/TimelineSkeleton';
import TimelineStream, { type TimelineStreamHandle } from './stream/TimelineStream';
import TimelineToolbar from './toolbar/TimelineToolbar';
import './TimelinePage.css';

interface TimelinePageProps {
  globalDisplayLanguage: string;
}

type TrackModalState =
  | { mode: 'edit'; track: TimelineTrack }
  | { mode: 'create'; parentId: string | null; parentName: string | null; chainToEvent: boolean };

type EventModalState =
  | { mode: 'edit'; event: TimelineEvent }
  | { mode: 'create'; defaults: EventCreateDefaults };

function findTrack(tracks: TimelineTrack[], trackId: string): TimelineTrack | null {
  for (const track of tracks) {
    if (track.id === trackId) return track;
    const found = findTrack(track.children ?? [], trackId);
    if (found) return found;
  }
  return null;
}

function trackPathIds(tracks: TimelineTrack[], trackId: string, path: string[] = []): string[] | null {
  for (const track of tracks) {
    const next = [...path, track.id];
    if (track.id === trackId) return next;
    const found = trackPathIds(track.children ?? [], trackId, next);
    if (found) return found;
  }
  return null;
}

function findEventTrackId(tracks: TimelineTrack[], eventId: string): string | null {
  for (const track of tracks) {
    if ((track.events ?? []).some((event) => event.id === eventId)) return track.id;
    const found = findEventTrackId(track.children ?? [], eventId);
    if (found) return found;
  }
  return null;
}

function hasLeafTrack(tracks: TimelineTrack[]): boolean {
  return tracks.some((track) => (track.children?.length ?? 0) === 0 || hasLeafTrack(track.children));
}

const TimelinePage: React.FC<TimelinePageProps> = ({ globalDisplayLanguage }) => {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId ?? '';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  const activeTagFilter = useUiStore((s) => s.activeTagFilter);
  const setTagFilter = useUiStore((s) => s.setTagFilter);
  const displayLanguage = useSelectionStore((s) => s.preferredDisplayLanguage) || globalDisplayLanguage;

  const configQuery = useTimelineConfig(pid);
  const timelineConfig = configQuery.data ?? null;
  const trackQuery = useObjectCollectionQuery(pid, 'timeline_track', displayLanguage, 'markdown');
  const eventQuery = useObjectCollectionQuery(pid, 'timeline_event', displayLanguage, 'markdown');
  const isLoading = configQuery.isLoading || trackQuery.isLoading || eventQuery.isLoading;
  const unifiedObjects = useMemo(() => {
    const map: Record<string, UnifiedObject> = {};
    for (const o of [...(trackQuery.data ?? []), ...(eventQuery.data ?? [])]) map[o.id] = o;
    return map;
  }, [trackQuery.data, eventQuery.data]);
  const getRichTextMarkdown = useCallback(
    (id: string, _lang: string, field: string): string | undefined => {
      const v = (unifiedObjects[id]?.data as Record<string, unknown> | undefined)?.[field];
      return typeof v === 'string' ? v : undefined;
    },
    [unifiedObjects],
  );

  const hiddenIds = useUiStore((s) => s.hiddenTrackIdsByProject[pid]);
  const showAllTracks = useUiStore((s) => s.showAllTracks);
  const unhideAncestorChain = useUiStore((s) => s.unhideAncestorChain);
  const pruneHiddenTracks = useUiStore((s) => s.pruneHiddenTracks);
  const dismissedWarningsKey = useUiStore((s) => s.dismissedWarningsKey);
  const setDismissedWarningsKey = useUiStore((s) => s.setDismissedWarningsKey);

  const sidebarOpen = useUiStore((s) => s.isOpen(pid, 'timeline'));

  const timeline = useMemo(
    () => buildTimelineFromObjects(pid, unifiedObjects, timelineConfig),
    [pid, unifiedObjects, timelineConfig],
  );
  const calendar = timeline?.calendar ?? DEFAULT_CALENDAR;
  const tracks = useMemo(() => timeline?.tracks ?? [], [timeline]);

  // drop persisted hidden ids whose tracks were deleted elsewhere
  useEffect(() => {
    const ids = new Set<string>();
    const walk = (list: TimelineTrack[]) => {
      for (const track of list) {
        ids.add(track.id);
        walk(track.children ?? []);
      }
    };
    walk(timeline.tracks);
    pruneHiddenTracks(pid, ids);
  }, [timeline, pid, pruneHiddenTracks]);

  const hiddenTrackIds = useMemo(() => new Set(hiddenIds ?? []), [hiddenIds]);
  const tagFilter = useMemo(() => new Set(activeTagFilter), [activeTagFilter]);
  const resolveTimelineEventContent = useCallback(
    (event: TimelineEvent) => getRichTextMarkdown(event.id, displayLanguage, 'content'),
    [displayLanguage, getRichTextMarkdown],
  );

  const layout = useTimelineLayout({
    tracks,
    calendar,
    hiddenTrackIds,
    tagFilter,
    displayLanguage,
    resolveContentMarkdown: resolveTimelineEventContent,
    isMobile,
  });

  // link names for cards + the edit modal
  const { groups: pickerGroups } = useObjectPickerData({ projectId: pid, language: displayLanguage, mode: 'all' });
  const linkGroups = useMemo(() => filterLinkGroups(pickerGroups), [pickerGroups]);
  const linkItems = useMemo(() => collectLinkItems(linkGroups), [linkGroups]);

  // ----- modal state
  const [eventModal, setEventModal] = useState<EventModalState | null>(null);
  const [trackModal, setTrackModal] = useState<TrackModalState | null>(null);
  const [movingTrack, setMovingTrack] = useState<TimelineTrack | null>(null);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [showJumpModal, setShowJumpModal] = useState(false);
  const [pendingScrollEventId, setPendingScrollEventId] = useState<string | null>(null);

  const streamRef = useRef<TimelineStreamHandle | null>(null);

  const lastAnchorDate = useMemo((): TimelineDate | undefined => {
    for (let i = layout.rows.length - 1; i >= 0; i -= 1) {
      const row = layout.rows[i];
      if (row.kind === 'anchor') return { ...row.date };
    }
    return undefined;
  }, [layout]);

  const openCreateEvent = useCallback(async (defaults?: EventCreateDefaults) => {
    if (!hasLeafTrack(tracks)) {
      const ok = await confirmDialog({
        title: t('timeline.empty.noTracksTitle'),
        message: t('timeline.empty.needTrackForEvent'),
        variant: 'info',
        confirmLabel: t('timeline.empty.createFirstTrack'),
        cancelLabel: t('common.cancel'),
      });
      if (ok) setTrackModal({ mode: 'create', parentId: null, parentName: null, chainToEvent: true });
      return;
    }
    setEventModal({ mode: 'create', defaults: { startDate: lastAnchorDate, ...defaults } });
  }, [tracks, lastAnchorDate, t]);

  const handleQuickAdd = useCallback((date: TimelineDate) => {
    void openCreateEvent({ startDate: { ...date } });
  }, [openCreateEvent]);

  const handleEventCreated = useCallback((event: TimelineEvent) => {
    const path = trackPathIds(tracks, event.trackId);
    if (path) unhideAncestorChain(pid, path);
    setPendingScrollEventId(event.id);
  }, [tracks, unhideAncestorChain, pid]);

  const handleTrackCreated = useCallback((track: TimelineTrack, chainToEvent: boolean) => {
    if (chainToEvent) {
      setEventModal({ mode: 'create', defaults: { trackId: track.id, startDate: lastAnchorDate } });
    }
  }, [lastAnchorDate]);

  // scroll to a freshly created / deep-linked event once it exists in the layout
  useEffect(() => {
    if (!pendingScrollEventId) return;
    if (!layout.rowIndexByEventId.has(pendingScrollEventId)) return;
    const id = pendingScrollEventId;
    setPendingScrollEventId(null);
    requestAnimationFrame(() => streamRef.current?.scrollToEvent(id));
  }, [pendingScrollEventId, layout]);

  // ?event=<id> deep link: unhide its track chain, scroll, then strip the param
  useEffect(() => {
    const eventId = searchParams.get('event');
    if (!eventId || !timeline) return;
    const trackId = findEventTrackId(timeline.tracks, eventId);
    if (trackId) {
      const path = trackPathIds(timeline.tracks, trackId);
      if (path) unhideAncestorChain(pid, path);
      setPendingScrollEventId(eventId);
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('event');
      return next;
    }, { replace: true });
  }, [searchParams, timeline, pid, unhideAncestorChain, setSearchParams]);

  const handleDeleteEvent = useCallback(async (ve: VisibleEvent) => {
    const ok = await confirmDialog({
      title: t('timeline.eventModal.deleteConfirmTitle'),
      message: t('timeline.eventModal.deleteConfirmBody', { name: ve.name || t('timeline.card.untitled') }),
      variant: 'danger',
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    await deleteEvent(pid, ve.event.id, displayLanguage);
  }, [deleteEvent, pid, displayLanguage, t]);

  const handleNavigateLink = useCallback((link: { objectType: string; objectId: string }) => {
    if (link.objectType === 'story_entity') {
      navigate(`/project/${pid}/story-entity?focus=${link.objectId}`);
    } else if (link.objectType === 'outline') {
      navigate(`/project/${pid}/outline-manager?focus=${link.objectId}`);
    }
  }, [navigate, pid]);

  const handleTagClick = useCallback((tag: string) => {
    if (!activeTagFilter.includes(tag)) setTagFilter([...activeTagFilter, tag]);
  }, [activeTagFilter, setTagFilter]);

  const handleToggleTag = useCallback((tag: string) => {
    setTagFilter(activeTagFilter.includes(tag)
      ? activeTagFilter.filter((value) => value !== tag)
      : [...activeTagFilter, tag]);
  }, [activeTagFilter, setTagFilter]);

  // ----- warnings banner
  const warningsKey = (timeline?.warnings ?? []).join('|');
  const showWarnings = warningsKey.length > 0 && dismissedWarningsKey !== warningsKey;

  // ----- shared track tree props
  const treeProps = {
    projectId: pid,
    tracks,
    displayLanguage,
    visibleCount: layout.visibleCount,
    totalCount: layout.totalCount,
    onEditTrack: (track: TimelineTrack) => setTrackModal({ mode: 'edit', track }),
    onAddChild: (parentId: string | null) => {
      const parent = parentId ? findTrack(tracks, parentId) : null;
      setTrackModal({
        mode: 'create',
        parentId,
        parentName: parent ? (resolveEntityText(parent.data, displayLanguage).name || t('timeline.tree.untitled')) : null,
        chainToEvent: false,
      });
    },
    onAddEvent: (trackId: string) => { void openCreateEvent({ trackId }); },
    onMoveTrack: (track: TimelineTrack) => setMovingTrack(track),
  };

  // ----- empty / loading states
  let emptyKind: EmptyStateKind | null = null;
  if (tracks.length === 0) emptyKind = 'no-tracks';
  else if (layout.totalCount === 0) emptyKind = 'no-events';
  else if (layout.visibleCount === 0) emptyKind = activeTagFilter.length > 0 ? 'no-matches' : 'all-hidden';

  const anyModalOpen = eventModal !== null || trackModal !== null || movingTrack !== null || showCalendarModal || showJumpModal;
  const showFab = isMobile && !anyModalOpen && !sidebarOpen && tracks.length > 0;

  return (
    <div className="timeline-page">
      {showWarnings && (
        <div className="timeline-page__warnings" role="status">
          <Warning size="sm" />
          <div className="timeline-page__warnings-list">
            {(timeline?.warnings ?? []).map((warning, index) => (
              <span key={index}>{warning}</span>
            ))}
          </div>
          <button
            type="button"
            className="timeline-page__warnings-dismiss"
            onClick={() => setDismissedWarningsKey(warningsKey)}
            aria-label={t('timeline.warnings.dismiss')}
          >
            <Close size="sm" />
          </button>
        </div>
      )}

      <TimelineToolbar
        onCreateEvent={() => { void openCreateEvent(); }}
        onOpenCalendar={() => setShowCalendarModal(true)}
        onJumpStart={() => streamRef.current?.scrollToStart()}
        onJumpEnd={() => streamRef.current?.scrollToEnd()}
        onJumpToDate={() => setShowJumpModal(true)}
        allTags={layout.allTags}
        activeTags={activeTagFilter}
        onToggleTag={handleToggleTag}
        onClearTags={() => setTagFilter([])}
        hiddenTrackCount={hiddenTrackIds.size}
        onShowAllTracks={() => showAllTracks(pid)}
      />

      <div className="timeline-page__body">
        {isLoading ? (
          <TimelineSkeleton />
        ) : emptyKind ? (
          <TimelineEmptyState
            kind={emptyKind}
            onCreateTrack={() => treeProps.onAddChild(null)}
            onCreateEvent={() => { void openCreateEvent(); }}
            onShowAllTracks={() => showAllTracks(pid)}
            onClearFilters={() => setTagFilter([])}
          />
        ) : (
          <TimelineStream
            ref={streamRef}
            layout={layout}
            calendar={calendar}
            collapseAt={isMobile ? MOBILE_SPACING.clusterCollapseAt : DESKTOP_SPACING.clusterCollapseAt}
            linkItems={linkItems}
            onEditEvent={(ve) => setEventModal({ mode: 'edit', event: ve.event })}
            onDeleteEvent={(ve) => { void handleDeleteEvent(ve); }}
            onQuickAdd={handleQuickAdd}
            onTagClick={handleTagClick}
            onNavigateLink={handleNavigateLink}
          />
        )}

        <TrackTreePanel {...treeProps} />
      </div>

      {isMobile && <TrackTreeSidebar {...treeProps} />}
      {showFab && <TimelineFab onClick={() => { void openCreateEvent(); }} />}

      {eventModal && (
        <EventEditModal
          projectId={pid}
          calendar={calendar}
          tracks={tracks}
          displayLanguage={displayLanguage}
          event={eventModal.mode === 'edit' ? eventModal.event : null}
          defaults={eventModal.mode === 'create' ? eventModal.defaults : null}
          linkGroups={linkGroups}
          linkItems={linkItems}
          onClose={() => setEventModal(null)}
          onCreated={handleEventCreated}
        />
      )}

      {trackModal && (
        <TrackEditModal
          projectId={pid}
          track={trackModal.mode === 'edit' ? trackModal.track : null}
          parentId={trackModal.mode === 'create' ? trackModal.parentId : null}
          parentName={trackModal.mode === 'create' ? trackModal.parentName : null}
          displayLanguage={displayLanguage}
          onClose={() => setTrackModal(null)}
          onCreated={(track) => handleTrackCreated(track, trackModal.mode === 'create' && trackModal.chainToEvent)}
        />
      )}

      {movingTrack && (
        <MoveTrackModal
          projectId={pid}
          track={movingTrack}
          tracks={tracks}
          displayLanguage={displayLanguage}
          onClose={() => setMovingTrack(null)}
        />
      )}

      <CalendarConfigModal
        isOpen={showCalendarModal}
        projectId={pid}
        calendar={calendar}
        displayLanguage={displayLanguage}
        onClose={() => setShowCalendarModal(false)}
      />

      {showJumpModal && (
        <JumpToDateModal
          calendar={calendar}
          onJump={(base) => streamRef.current?.scrollToBase(base)}
          onClose={() => setShowJumpModal(false)}
        />
      )}
    </div>
  );
};

export default TimelinePage;

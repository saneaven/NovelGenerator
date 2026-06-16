import { useMemo } from 'react';
import { useTimelineStore } from '../../../store/timelineStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useObjectCollectionQuery } from '../../../data/objects/useObjectCollectionQuery';
import { defaultCalendar, formatDate } from '../../../utils/timelineCalendar';
import { buildTimelineFromObjects } from '../../../utils/timelineView';
import type { UnifiedObject } from '../../../types/unifiedObject';
import type {
  CalendarConfig,
  FullTimeline,
  TimelineDate,
  TimelineEvent,
  TimelineTrack,
} from '../../../types/timeline';

/**
 * Shared data-sourcing helpers for timeline tool-call cards.
 *
 * Timeline tracks / events are unified object projections. These helpers derive
 * a lookup from the unified object store and format dates with the project's
 * calendar config.
 */
export interface TimelineLookup {
  calendar: CalendarConfig;
  findTrack: (id: string | undefined | null) => TimelineTrack | undefined;
  findEvent: (id: string | undefined | null) => TimelineEvent | undefined;
}

function flattenTracks(tracks: TimelineTrack[], acc: TimelineTrack[] = []): TimelineTrack[] {
  for (const track of tracks) {
    acc.push(track);
    if (track.children?.length) flattenTracks(track.children, acc);
  }
  return acc;
}

function buildLookup(timeline: FullTimeline | null): TimelineLookup {
  const calendar = timeline?.calendar ?? defaultCalendar();
  const allTracks = timeline ? flattenTracks(timeline.tracks) : [];
  const trackById = new Map(allTracks.map((track) => [track.id, track] as const));
  const eventById = new Map<string, TimelineEvent>();
  for (const track of allTracks) {
    for (const event of track.events ?? []) {
      eventById.set(event.id, event);
    }
  }
  return {
    calendar,
    findTrack: (id) => (id ? trackById.get(id) : undefined),
    findEvent: (id) => (id ? eventById.get(id) : undefined),
  };
}

/** Resolve a lookup of existing timeline tracks/events for the given project. */
export function useTimelineLookup(projectId: string): TimelineLookup {
  const language = useSettingsStore((state) => state.getSettings().mainLanguage);
  const tracks = useObjectCollectionQuery(projectId, 'timeline_track', language);
  const events = useObjectCollectionQuery(projectId, 'timeline_event', language);
  const timelineConfig = useTimelineStore((state) => state.configByProject[projectId] ?? null);
  const timeline = useMemo(
    () => {
      const record: Record<string, UnifiedObject> = {};
      for (const obj of [...(tracks.data ?? []), ...(events.data ?? [])]) record[obj.id] = obj;
      return buildTimelineFromObjects(projectId, record, timelineConfig);
    },
    [tracks.data, events.data, projectId, timelineConfig],
  );
  return useMemo(() => buildLookup(timeline), [timeline]);
}

/** Return the projected value bag for a track/event. */
export function dataForLanguage(
  data: Record<string, unknown> | undefined,
  language: string,
): Record<string, unknown> {
  void language;
  return data ?? {};
}

/** Read a track/event display name from its projected data. */
export function timelineName(
  data: Record<string, unknown> | undefined,
  language: string,
): string | undefined {
  const value = dataForLanguage(data, language).name;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Format a timeline date object, tolerating missing/invalid calendars. */
export function safeFormatDate(date: unknown, calendar: CalendarConfig): string | undefined {
  if (!date || typeof date !== 'object' || Array.isArray(date)) return undefined;
  try {
    return formatDate(date as TimelineDate, calendar);
  } catch {
    return undefined;
  }
}

/** Coerce an unknown value into a string[] of trimmed, non-empty tags. */
export function asTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

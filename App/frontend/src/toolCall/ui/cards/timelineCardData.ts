import { useMemo } from 'react';
import { useTimelineStore } from '../../../store/timelineStore';
import { defaultCalendar, formatDate } from '../../../utils/timelineCalendar';
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
 * Timeline tracks / events live in `useTimelineStore` (not the unified object
 * store), so the generic `getObjectSnapshot` resolver returns nothing for them.
 * These helpers look the objects up directly and format dates with the
 * project's calendar config.
 */
export interface TimelineLookup {
  calendar: CalendarConfig;
  findTrack: (id: string | undefined | null) => TimelineTrack | undefined;
  findEvent: (id: string | undefined | null) => TimelineEvent | undefined;
  trackCount: number;
  eventCount: number;
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
    trackCount: allTracks.length,
    eventCount: eventById.size,
  };
}

/** Resolve a lookup of existing timeline tracks/events for the given project. */
export function useTimelineLookup(projectId: string): TimelineLookup {
  const timeline = useTimelineStore((state) =>
    state.loadedProjectId === projectId ? state.timeline : null
  );
  return useMemo(() => buildLookup(timeline), [timeline]);
}

/** Pick the localized value bag for a track/event, falling back to any language. */
export function dataForLanguage(
  data: Record<string, Record<string, unknown>> | undefined,
  language: string
): Record<string, unknown> {
  if (!data) return {};
  if (data[language]) return data[language];
  const fallback = Object.keys(data)[0];
  return fallback ? data[fallback] : {};
}

/** Read a track/event display name from its localized data. */
export function timelineName(
  data: Record<string, Record<string, unknown>> | undefined,
  language: string
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

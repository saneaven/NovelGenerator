/**
 * Imperative timeline mutations. Tracks/events are unified objects, so each
 * command calls the service then invalidates the affected object collection(s);
 * mounted `useObjectCollectionQuery` consumers refetch reactively (no manual
 * `changeRevision` bookkeeping). Calendar updates patch the config query cache.
 */

import { queryClient } from '../queryClient';
import { objectKeys } from '../keys/objectKeys';
import { timelineService } from '../../api/timelineService';
import { buildTimelineFromObjects } from '../../utils/timelineView';
import { readTimelineConfigFromCache, setTimelineConfigInCache } from './useTimelineConfigQuery';
import type {
  CalendarConfig,
  TimelineEvent,
  TimelineEventCreateRequest,
  TimelineEventLink,
  TimelineEventUpdateRequest,
  TimelineTrack,
  TimelineTrackCreateRequest,
  TimelineTrackMoveRequest,
  TimelineTrackUpdateRequest,
} from '../../types/timeline';
import type { ObjectType, TimelineObjectData, UnifiedObject } from '../../types/unifiedObject';

const TIMELINE_TYPES: ObjectType[] = ['timeline_track', 'timeline_event'];

function applyTimelineObject(object: UnifiedObject<TimelineObjectData>): void {
  const projectId = object.metadata?.project_id;
  if (typeof projectId !== 'string') return;
  queryClient.invalidateQueries({ queryKey: objectKeys.collectionType(projectId, object.type) });
  // Mark the body's detail query stale so the next edit-open is fresh.
  queryClient.invalidateQueries({ queryKey: objectKeys.detailOf(object.type, object.id) });
}

function invalidateTimelineCollections(projectId: string): void {
  for (const type of TIMELINE_TYPES) {
    queryClient.invalidateQueries({ queryKey: objectKeys.collectionType(projectId, type) });
  }
}

/** Read the project's timeline objects from the query cache (markdown ?? tiptap). */
function timelineObjectsRecord(projectId: string, language: string): Record<string, UnifiedObject> {
  const record: Record<string, UnifiedObject> = {};
  for (const type of TIMELINE_TYPES) {
    const collection =
      queryClient.getQueryData<UnifiedObject[]>(objectKeys.collection(projectId, type, language, 'markdown'))
      ?? queryClient.getQueryData<UnifiedObject[]>(objectKeys.collection(projectId, type, language, 'tiptap'));
    if (collection) for (const object of collection) record[object.id] = object;
  }
  return record;
}

function buildTimeline(projectId: string, language: string): ReturnType<typeof buildTimelineFromObjects> {
  return buildTimelineFromObjects(projectId, timelineObjectsRecord(projectId, language), readTimelineConfigFromCache(projectId));
}

function findTrack(tracks: TimelineTrack[], id: string): TimelineTrack | null {
  for (const track of tracks) {
    if (track.id === id) return track;
    const child = findTrack(track.children ?? [], id);
    if (child) return child;
  }
  return null;
}

function findEvent(tracks: TimelineTrack[], id: string): TimelineEvent | null {
  for (const track of tracks) {
    const event = (track.events ?? []).find((item) => item.id === id);
    if (event) return event;
    const child = findEvent(track.children ?? [], id);
    if (child) return child;
  }
  return null;
}

function linksFromMetadata(value: unknown): TimelineEventLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const eventId = typeof record.event_id === 'string' ? record.event_id : '';
    const objectType = typeof record.object_type === 'string' ? record.object_type : '';
    const objectId = typeof record.object_id === 'string' ? record.object_id : '';
    if (!id || !eventId || !objectType || !objectId) return [];
    return [{
      id,
      eventId,
      objectType,
      objectId,
      createdAt: typeof record.created_at === 'string' ? record.created_at : null,
    }];
  });
}

export async function updateCalendar(projectId: string, calendar: CalendarConfig, _language?: string): Promise<void> {
  const config = await timelineService.updateCalendar(projectId, calendar);
  setTimelineConfigInCache(projectId, config);
}

export async function createTrack(
  projectId: string,
  request: TimelineTrackCreateRequest,
  language: string,
): Promise<TimelineTrack> {
  const created = await timelineService.createTrack(projectId, request);
  applyTimelineObject(created);
  return findTrack(buildTimeline(projectId, language).tracks, created.id)
    ?? {
      id: created.id,
      timelineId: String(created.metadata.timeline_id ?? ''),
      parentId: (created.metadata.parent_id as string | null | undefined) ?? null,
      position: Number(created.metadata.position ?? 0),
      color: String(created.metadata.color ?? ''),
      createdAt: created.metadata.created_at ?? null,
      updatedAt: created.metadata.updated_at ?? null,
      data: created.data as unknown as Record<string, unknown>,
      languageState: created.language_state,
      version: { id: created.version?.id ?? null, number: created.version?.number ?? 0, createdAt: created.version?.created_at ?? null },
      events: [],
      children: [],
    };
}

export async function updateTrack(
  projectId: string,
  trackId: string,
  request: TimelineTrackUpdateRequest,
  _language?: string,
): Promise<void> {
  const updated = await timelineService.updateTrack(projectId, trackId, request);
  applyTimelineObject(updated);
}

export async function moveTrack(
  projectId: string,
  trackId: string,
  request: TimelineTrackMoveRequest,
  _language?: string,
): Promise<void> {
  const updated = await timelineService.moveTrack(projectId, trackId, request);
  applyTimelineObject(updated);
}

export async function deleteTrack(projectId: string, trackId: string, _language?: string): Promise<void> {
  await timelineService.deleteTrack(projectId, trackId);
  invalidateTimelineCollections(projectId);
}

export async function createEvent(
  projectId: string,
  request: TimelineEventCreateRequest,
  language: string,
): Promise<TimelineEvent> {
  const created = await timelineService.createEvent(projectId, request);
  applyTimelineObject(created);
  return findEvent(buildTimeline(projectId, language).tracks, created.id)
    ?? {
      id: created.id,
      trackId: String(created.metadata.track_id ?? request.trackId),
      startDate: (created.metadata.start_date as Record<string, number> | undefined) ?? request.startDate,
      endDate: (created.metadata.end_date as Record<string, number> | null | undefined) ?? request.endDate ?? null,
      tags: Array.isArray(created.metadata.tags) ? created.metadata.tags : request.tags ?? [],
      createdAt: created.metadata.created_at ?? null,
      updatedAt: created.metadata.updated_at ?? null,
      data: created.data as unknown as Record<string, unknown>,
      languageState: created.language_state,
      version: { id: created.version?.id ?? null, number: created.version?.number ?? 0, createdAt: created.version?.created_at ?? null },
      links: linksFromMetadata(created.metadata.links),
    };
}

export async function updateEvent(
  projectId: string,
  eventId: string,
  request: TimelineEventUpdateRequest,
  _language?: string,
): Promise<void> {
  const updated = await timelineService.updateEvent(projectId, eventId, request);
  applyTimelineObject(updated);
}

export async function deleteEvent(projectId: string, eventId: string, _language?: string): Promise<void> {
  await timelineService.deleteEvent(projectId, eventId);
  invalidateTimelineCollections(projectId);
}

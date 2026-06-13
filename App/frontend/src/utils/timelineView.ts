import type { CalendarConfig, FullTimeline, TimelineEvent, TimelineTrack } from '../types/timeline';
import type { UnifiedObject } from '../types/unifiedObject';
import { DEFAULT_CALENDAR } from './timelineCalendar';

interface TimelineConfigLike {
  id?: string | null;
  projectId?: string | null;
  project_id?: string | null;
  calendar?: CalendarConfig | null;
  warnings?: string[];
}

function normalizeDate(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    const num = Number(raw);
    if (Number.isFinite(num)) out[key] = num;
  });
  return out;
}

function normalizeLinks(value: unknown): TimelineEvent['links'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((link): link is Record<string, unknown> => Boolean(link) && typeof link === 'object' && !Array.isArray(link))
    .map((link) => ({
      id: String(link.id ?? ''),
      eventId: String(link.event_id ?? link.eventId ?? ''),
      objectType: String(link.object_type ?? link.objectType ?? ''),
      objectId: String(link.object_id ?? link.objectId ?? ''),
      createdAt: typeof link.created_at === 'string' ? link.created_at : typeof link.createdAt === 'string' ? link.createdAt : null,
    }))
    .filter((link) => link.id && link.eventId && link.objectType && link.objectId);
}

function byPositionThenCreated(a: TimelineTrack, b: TimelineTrack): number {
  if (a.position !== b.position) return a.position - b.position;
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);
}

function byCreatedThenId(a: TimelineEvent, b: TimelineEvent): number {
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);
}

export function buildTimelineFromObjects(
  projectId: string,
  objects: Record<string, UnifiedObject>,
  config?: TimelineConfigLike | null,
): FullTimeline {
  const projectObjects = Object.values(objects).filter((object) => object.metadata?.project_id === projectId);
  const trackObjects = projectObjects.filter((object) => object.type === 'timeline_track');
  const eventObjects = projectObjects.filter((object) => object.type === 'timeline_event');

  const eventsByTrack = new Map<string, TimelineEvent[]>();
  for (const object of eventObjects) {
    const trackId = String(object.metadata.track_id ?? '');
    if (!trackId) continue;
    const event: TimelineEvent = {
      id: object.id,
      trackId,
      startDate: normalizeDate(object.metadata.start_date),
      endDate: object.metadata.end_date ? normalizeDate(object.metadata.end_date) : null,
      tags: Array.isArray(object.metadata.tags) ? object.metadata.tags.map(String).filter(Boolean) : [],
      createdAt: object.metadata.created_at ?? null,
      updatedAt: object.metadata.updated_at ?? null,
      data: object.data as unknown as Record<string, unknown>,
      languageState: object.language_state,
      version: {
        id: object.version?.id ?? null,
        number: object.version?.number ?? 0,
        createdAt: object.version?.created_at ?? null,
      },
      links: normalizeLinks(object.metadata.links),
    };
    const events = eventsByTrack.get(trackId) ?? [];
    events.push(event);
    eventsByTrack.set(trackId, events);
  }
  eventsByTrack.forEach((events) => events.sort(byCreatedThenId));

  const tracksById = new Map<string, TimelineTrack>();
  const childrenByParent = new Map<string | null, TimelineTrack[]>();
  for (const object of trackObjects) {
    const parentId = (object.metadata.parent_id as string | null | undefined) ?? null;
    const track: TimelineTrack = {
      id: object.id,
      timelineId: String(object.metadata.timeline_id ?? config?.id ?? ''),
      parentId,
      position: Number(object.metadata.position ?? 0),
      color: String(object.metadata.color ?? ''),
      createdAt: object.metadata.created_at ?? null,
      updatedAt: object.metadata.updated_at ?? null,
      data: object.data as unknown as Record<string, unknown>,
      languageState: object.language_state,
      version: {
        id: object.version?.id ?? null,
        number: object.version?.number ?? 0,
        createdAt: object.version?.created_at ?? null,
      },
      events: eventsByTrack.get(object.id) ?? [],
      children: [],
    };
    tracksById.set(track.id, track);
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(track);
    childrenByParent.set(parentId, siblings);
  }

  childrenByParent.forEach((siblings) => siblings.sort(byPositionThenCreated));
  for (const track of tracksById.values()) {
    track.children = childrenByParent.get(track.id) ?? [];
  }

  return {
    id: String(config?.id ?? ''),
    projectId: String(config?.projectId ?? config?.project_id ?? projectId),
    calendar: config?.calendar ?? DEFAULT_CALENDAR,
    tracks: childrenByParent.get(null) ?? [],
    warnings: config?.warnings ?? [],
  };
}

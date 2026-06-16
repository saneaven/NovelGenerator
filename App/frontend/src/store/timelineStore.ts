import { create } from 'zustand';
import { timelineService, type TimelineConfig } from '../api/timelineService';
import { queryClient } from '../data/queryClient';
import { objectKeys } from '../data/keys/objectKeys';
import { fetchObjectCollection } from '../data/objects/useObjectCollectionQuery';
import type {
  CalendarConfig,
  TimelineEvent,
  TimelineEventCreateRequest,
  TimelineEventLinkRequest,
  TimelineEventUpdateRequest,
  TimelineTrack,
  TimelineTrackCreateRequest,
  TimelineTrackMoveRequest,
  TimelineTrackUpdateRequest,
} from '../types/timeline';
import type { TimelineObjectData, ObjectType, UnifiedObject } from '../types/unifiedObject';
import { buildTimelineFromObjects } from '../utils/timelineView';

let fetchTimelineRequestSeq = 0;

const TIMELINE_TYPES: ObjectType[] = ['timeline_track', 'timeline_event'];

interface TimelineStore {
  configByProject: Record<string, TimelineConfig>;
  isLoading: boolean;
  error: string | null;
  activeTagFilter: string[];
  loadedProjectId: string | null;
  loadedLanguage: string | null;
  changeRevision: number;

  fetchTimeline: (projectId: string, language: string, options?: { force?: boolean }) => Promise<void>;
  setTagFilter: (tags: string[]) => void;
  updateCalendar: (projectId: string, calendar: CalendarConfig, language: string) => Promise<void>;
  createTrack: (projectId: string, request: TimelineTrackCreateRequest, language: string) => Promise<TimelineTrack>;
  updateTrack: (projectId: string, trackId: string, request: TimelineTrackUpdateRequest, language: string) => Promise<void>;
  moveTrack: (projectId: string, trackId: string, request: TimelineTrackMoveRequest, language: string) => Promise<void>;
  deleteTrack: (projectId: string, trackId: string, language: string) => Promise<void>;
  createEvent: (projectId: string, request: TimelineEventCreateRequest, language: string) => Promise<TimelineEvent>;
  updateEvent: (projectId: string, eventId: string, request: TimelineEventUpdateRequest, language: string) => Promise<void>;
  deleteEvent: (projectId: string, eventId: string, language: string) => Promise<void>;
  createEventLink: (projectId: string, eventId: string, request: TimelineEventLinkRequest, language: string) => Promise<void>;
  deleteEventLink: (projectId: string, eventId: string, linkId: string, language: string) => Promise<void>;
  clearProject: (projectId: string) => void;
}

/**
 * Reflect a created/updated timeline object: invalidate its collection so any
 * mounted query refetches in the correct format. Callers that need the value
 * immediately fall back to the service response (see createTrack/createEvent).
 */
function applyTimelineObject(object: UnifiedObject<TimelineObjectData>): void {
  const projectId = object.metadata?.project_id;
  if (typeof projectId !== 'string') return;
  queryClient.invalidateQueries({ queryKey: objectKeys.collectionType(projectId, object.type) });
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

function buildTimeline(projectId: string, language: string, config?: TimelineConfig): ReturnType<typeof buildTimelineFromObjects> {
  return buildTimelineFromObjects(projectId, timelineObjectsRecord(projectId, language), config);
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

export const useTimelineStore = create<TimelineStore>((set, get) => ({
  configByProject: {},
  isLoading: false,
  error: null,
  activeTagFilter: [],
  loadedProjectId: null,
  loadedLanguage: null,
  changeRevision: 0,

  fetchTimeline: async (projectId, language, options) => {
    const { loadedProjectId, loadedLanguage, configByProject } = get();
    if (!options?.force && configByProject[projectId] && loadedProjectId === projectId && loadedLanguage === language) {
      return;
    }

    const requestSeq = ++fetchTimelineRequestSeq;
    set({ isLoading: true, error: null });

    try {
      const [config] = await Promise.all([
        timelineService.getTimelineConfig(projectId),
        ...TIMELINE_TYPES.map((type) =>
          queryClient.ensureQueryData({
            queryKey: objectKeys.collection(projectId, type, language, 'markdown'),
            queryFn: () => fetchObjectCollection(projectId, type, language, 'markdown'),
          }),
        ),
      ]);
      if (requestSeq !== fetchTimelineRequestSeq) return;
      set((state) => ({
        configByProject: { ...state.configByProject, [projectId]: config },
        isLoading: false,
        loadedProjectId: projectId,
        loadedLanguage: language,
        changeRevision: state.changeRevision + 1,
      }));
    } catch (error) {
      if (requestSeq !== fetchTimelineRequestSeq) return;
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load timeline',
      });
      throw error;
    }
  },

  setTagFilter: (tags) => {
    set({ activeTagFilter: [...new Set(tags.filter(Boolean))] });
  },

  updateCalendar: async (projectId, calendar) => {
    const config = await timelineService.updateCalendar(projectId, calendar);
    set((state) => ({
      configByProject: { ...state.configByProject, [projectId]: config },
      changeRevision: state.changeRevision + 1,
    }));
  },

  createTrack: async (projectId, request, language) => {
    const created = await timelineService.createTrack(projectId, request);
    applyTimelineObject(created);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
    return findTrack(buildTimeline(projectId, language, get().configByProject[projectId]).tracks, created.id)
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
  },

  updateTrack: async (projectId, trackId, request) => {
    const updated = await timelineService.updateTrack(projectId, trackId, request);
    applyTimelineObject(updated);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
  },

  moveTrack: async (projectId, trackId, request) => {
    const updated = await timelineService.moveTrack(projectId, trackId, request);
    applyTimelineObject(updated);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
  },

  deleteTrack: async (projectId, trackId) => {
    await timelineService.deleteTrack(projectId, trackId);
    invalidateTimelineCollections(projectId);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
  },

  createEvent: async (projectId, request, language) => {
    const created = await timelineService.createEvent(projectId, request);
    applyTimelineObject(created);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
    return findEvent(buildTimeline(projectId, language, get().configByProject[projectId]).tracks, created.id)
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
        links: [],
      };
  },

  updateEvent: async (projectId, eventId, request) => {
    const updated = await timelineService.updateEvent(projectId, eventId, request);
    applyTimelineObject(updated);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
  },

  deleteEvent: async (projectId, eventId) => {
    await timelineService.deleteEvent(projectId, eventId);
    invalidateTimelineCollections(projectId);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
  },

  createEventLink: async (projectId, eventId, request, language) => {
    const updated = await timelineService.createEventLink(projectId, eventId, request, language);
    applyTimelineObject(updated);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
  },

  deleteEventLink: async (projectId, eventId, linkId, language) => {
    const updated = await timelineService.deleteEventLink(projectId, eventId, linkId, language);
    applyTimelineObject(updated);
    set((state) => ({ changeRevision: state.changeRevision + 1 }));
  },

  clearProject: (projectId) => {
    set((state) => {
      const nextConfig = { ...state.configByProject };
      delete nextConfig[projectId];
      return {
        configByProject: nextConfig,
        isLoading: false,
        error: null,
        loadedProjectId: state.loadedProjectId === projectId ? null : state.loadedProjectId,
        loadedLanguage: state.loadedProjectId === projectId ? null : state.loadedLanguage,
      };
    });
  },
}));

export default useTimelineStore;

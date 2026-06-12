import { create } from 'zustand';
import { timelineService } from '../api/timelineService';
import type {
  CalendarConfig,
  FullTimeline,
  TimelineEvent,
  TimelineEventCreateRequest,
  TimelineEventLinkRequest,
  TimelineEventUpdateRequest,
  TimelineTrack,
  TimelineTrackCreateRequest,
  TimelineTrackMoveRequest,
  TimelineTrackUpdateRequest,
} from '../types/timeline';

interface TimelineStore {
  timeline: FullTimeline | null;
  isLoading: boolean;
  error: string | null;
  activeTagFilter: string[];
  loadedProjectId: string | null;
  loadedLanguage: string | null;

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

export const useTimelineStore = create<TimelineStore>((set, get) => ({
  timeline: null,
  isLoading: false,
  error: null,
  activeTagFilter: [],
  loadedProjectId: null,
  loadedLanguage: null,

  fetchTimeline: async (projectId, language, options) => {
    const { timeline, loadedProjectId, loadedLanguage } = get();
    if (!options?.force && timeline && loadedProjectId === projectId && loadedLanguage === language) {
      return;
    }

    set({
      isLoading: true,
      error: null,
    });

    try {
      // Tag filtering happens client-side in the layout engine: the full event set
      // is needed for the filter UI's tag list, and filter changes must not refetch.
      const nextTimeline = await timelineService.getTimeline(projectId, language);
      set({
        timeline: nextTimeline,
        isLoading: false,
        loadedProjectId: projectId,
        loadedLanguage: language,
      });
    } catch (error) {
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

  updateCalendar: async (projectId, calendar, language) => {
    await timelineService.updateCalendar(projectId, calendar, language);
    await get().fetchTimeline(projectId, language, { force: true });
  },

  createTrack: async (projectId, request, language) => {
    const created = await timelineService.createTrack(projectId, request);
    await get().fetchTimeline(projectId, language, { force: true });
    return created;
  },

  updateTrack: async (projectId, trackId, request, language) => {
    await timelineService.updateTrack(projectId, trackId, request);
    await get().fetchTimeline(projectId, language, { force: true });
  },

  moveTrack: async (projectId, trackId, request, language) => {
    await timelineService.moveTrack(projectId, trackId, request);
    await get().fetchTimeline(projectId, language, { force: true });
  },

  deleteTrack: async (projectId, trackId, language) => {
    await timelineService.deleteTrack(projectId, trackId);
    await get().fetchTimeline(projectId, language, { force: true });
  },

  createEvent: async (projectId, request, language) => {
    const created = await timelineService.createEvent(projectId, request);
    await get().fetchTimeline(projectId, language, { force: true });
    return created;
  },

  updateEvent: async (projectId, eventId, request, language) => {
    await timelineService.updateEvent(projectId, eventId, request);
    await get().fetchTimeline(projectId, language, { force: true });
  },

  deleteEvent: async (projectId, eventId, language) => {
    await timelineService.deleteEvent(projectId, eventId);
    await get().fetchTimeline(projectId, language, { force: true });
  },

  createEventLink: async (projectId, eventId, request, language) => {
    await timelineService.createEventLink(projectId, eventId, request);
    await get().fetchTimeline(projectId, language, { force: true });
  },

  deleteEventLink: async (projectId, eventId, linkId, language) => {
    await timelineService.deleteEventLink(projectId, eventId, linkId);
    await get().fetchTimeline(projectId, language, { force: true });
  },

  clearProject: (projectId) => {
    if (get().loadedProjectId !== projectId) {
      return;
    }
    set({
      timeline: null,
      isLoading: false,
      error: null,
      loadedProjectId: null,
      loadedLanguage: null,
    });
  },
}));

export default useTimelineStore;

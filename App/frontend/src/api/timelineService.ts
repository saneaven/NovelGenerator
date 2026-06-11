import { apiClient } from './client';
import type {
  CalendarConfig,
  FullTimeline,
  TimelineEvent,
  TimelineEventCreateRequest,
  TimelineEventLink,
  TimelineEventLinkRequest,
  TimelineEventUpdateRequest,
  TimelineTrack,
  TimelineTrackCreateRequest,
  TimelineTrackMoveRequest,
  TimelineTrackUpdateRequest,
} from '../types/timeline';

type QueryValue = string | number | boolean | null | undefined;

function buildQueryString(params: Record<string, QueryValue | QueryValue[] | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null) return;
        search.append(key, String(item));
      });
      return;
    }
    search.append(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

type ApiTimelineVersion = {
  id: string | null;
  number: number;
  created_at: string | null;
};

type ApiTimelineEventLink = {
  id: string;
  event_id: string;
  object_type: string;
  object_id: string;
  created_at: string | null;
};

type ApiTimelineEvent = {
  id: string;
  track_id: string;
  start_date: Record<string, number>;
  end_date?: Record<string, number> | null;
  tags: string[];
  created_at: string | null;
  updated_at: string | null;
  data: Record<string, Record<string, unknown>>;
  version: ApiTimelineVersion;
  links: ApiTimelineEventLink[];
};

type ApiTimelineTrack = {
  id: string;
  timeline_id: string;
  parent_id?: string | null;
  position: number;
  color?: string | null;
  created_at: string | null;
  updated_at: string | null;
  data: Record<string, Record<string, unknown>>;
  version: ApiTimelineVersion;
  events: ApiTimelineEvent[];
  children: ApiTimelineTrack[];
};

type ApiFullTimeline = {
  id: string;
  project_id: string;
  calendar: CalendarConfig;
  tracks: ApiTimelineTrack[];
  warnings: string[];
};

function normalizeVersion(version: ApiTimelineVersion) {
  return {
    id: version.id,
    number: version.number,
    createdAt: version.created_at,
  };
}

function normalizeLink(link: ApiTimelineEventLink): TimelineEventLink {
  return {
    id: link.id,
    eventId: link.event_id,
    objectType: link.object_type,
    objectId: link.object_id,
    createdAt: link.created_at,
  };
}

function normalizeEvent(event: ApiTimelineEvent): TimelineEvent {
  return {
    id: event.id,
    trackId: event.track_id,
    startDate: event.start_date,
    endDate: event.end_date ?? null,
    tags: event.tags ?? [],
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    data: event.data ?? {},
    version: normalizeVersion(event.version),
    links: Array.isArray(event.links) ? event.links.map(normalizeLink) : [],
  };
}

function normalizeTrack(track: ApiTimelineTrack): TimelineTrack {
  return {
    id: track.id,
    timelineId: track.timeline_id,
    parentId: track.parent_id ?? null,
    position: track.position,
    color: track.color ?? null,
    createdAt: track.created_at,
    updatedAt: track.updated_at,
    data: track.data ?? {},
    version: normalizeVersion(track.version),
    events: Array.isArray(track.events) ? track.events.map(normalizeEvent) : [],
    children: Array.isArray(track.children) ? track.children.map(normalizeTrack) : [],
  };
}

function normalizeTimeline(timeline: ApiFullTimeline): FullTimeline {
  return {
    id: timeline.id,
    projectId: timeline.project_id,
    calendar: timeline.calendar,
    tracks: Array.isArray(timeline.tracks) ? timeline.tracks.map(normalizeTrack) : [],
    warnings: Array.isArray(timeline.warnings) ? timeline.warnings : [],
  };
}

function serializeTrackCreate(request: TimelineTrackCreateRequest) {
  return {
    language: request.language,
    name: request.name,
    description: request.description ?? '',
    content: request.content ?? null,
    rich_text_format: 'tiptap',
    parent_id: request.parentId ?? null,
    position: request.position,
    color: request.color ?? null,
    user_request: request.userRequest ?? 'Timeline Track Creation',
  };
}

function serializeTrackUpdate(request: TimelineTrackUpdateRequest) {
  const payload: Record<string, unknown> = {
    user_request: request.userRequest ?? 'Timeline Track Update',
    create_new_version: request.createNewVersion ?? true,
    rich_text_format: 'tiptap',
  };
  if (request.language !== undefined) payload.language = request.language;
  if (request.name !== undefined) payload.name = request.name;
  if (request.description !== undefined) payload.description = request.description;
  if (request.content !== undefined) payload.content = request.content;
  if ('color' in request) payload.color = request.color ?? null;
  return payload;
}

function serializeEventCreate(request: TimelineEventCreateRequest) {
  return {
    track_id: request.trackId,
    language: request.language,
    name: request.name,
    description: request.description ?? '',
    content: request.content ?? null,
    rich_text_format: 'tiptap',
    start_date: request.startDate,
    end_date: request.endDate ?? null,
    tags: request.tags ?? [],
    links: (request.links ?? []).map((link) => ({
      object_type: link.objectType,
      object_id: link.objectId,
    })),
    user_request: request.userRequest ?? 'Timeline Event Creation',
  };
}

function serializeEventUpdate(request: TimelineEventUpdateRequest) {
  const payload: Record<string, unknown> = {
    user_request: request.userRequest ?? 'Timeline Event Update',
    create_new_version: request.createNewVersion ?? true,
    rich_text_format: 'tiptap',
  };
  if (request.trackId !== undefined) payload.track_id = request.trackId;
  if (request.language !== undefined) payload.language = request.language;
  if (request.name !== undefined) payload.name = request.name;
  if (request.description !== undefined) payload.description = request.description;
  if (request.content !== undefined) payload.content = request.content;
  if (request.startDate !== undefined) payload.start_date = request.startDate;
  if ('endDate' in request) payload.end_date = request.endDate ?? null;
  if (request.tags !== undefined) payload.tags = request.tags;
  return payload;
}

export const timelineService = {
  async getTimeline(projectId: string, language?: string, tags?: string[]): Promise<FullTimeline> {
    const query = buildQueryString({ language, tags });
    const response = await apiClient.get<ApiFullTimeline>(`/api/v1/projects/${projectId}/timeline${query}`);
    return normalizeTimeline(response);
  },

  async listTracks(projectId: string, language?: string): Promise<TimelineTrack[]> {
    const query = buildQueryString({ language });
    const response = await apiClient.get<ApiTimelineTrack[]>(`/api/v1/projects/${projectId}/timeline/tracks${query}`);
    return response.map(normalizeTrack);
  },

  async createTrack(projectId: string, request: TimelineTrackCreateRequest): Promise<TimelineTrack> {
    const response = await apiClient.post<ApiTimelineTrack>(
      `/api/v1/projects/${projectId}/timeline/tracks`,
      serializeTrackCreate(request),
    );
    return normalizeTrack(response);
  },

  async updateTrack(projectId: string, trackId: string, request: TimelineTrackUpdateRequest): Promise<TimelineTrack> {
    const response = await apiClient.put<ApiTimelineTrack>(
      `/api/v1/projects/${projectId}/timeline/tracks/${trackId}`,
      serializeTrackUpdate(request),
    );
    return normalizeTrack(response);
  },

  async moveTrack(projectId: string, trackId: string, request: TimelineTrackMoveRequest): Promise<TimelineTrack> {
    const response = await apiClient.patch<ApiTimelineTrack>(
      `/api/v1/projects/${projectId}/timeline/tracks/${trackId}/move`,
      {
        parent_id: request.parentId ?? null,
        position: request.position,
      },
    );
    return normalizeTrack(response);
  },

  async deleteTrack(projectId: string, trackId: string): Promise<void> {
    await apiClient.delete(`/api/v1/projects/${projectId}/timeline/tracks/${trackId}`);
  },

  async updateCalendar(projectId: string, calendar: CalendarConfig, language?: string): Promise<FullTimeline> {
    const query = buildQueryString({ language });
    const response = await apiClient.put<ApiFullTimeline>(
      `/api/v1/projects/${projectId}/timeline/calendar${query}`,
      { calendar },
    );
    return normalizeTimeline(response);
  },

  async createEvent(projectId: string, request: TimelineEventCreateRequest): Promise<TimelineEvent> {
    const response = await apiClient.post<ApiTimelineEvent>(
      `/api/v1/projects/${projectId}/timeline/events`,
      serializeEventCreate(request),
    );
    return normalizeEvent(response);
  },

  async updateEvent(projectId: string, eventId: string, request: TimelineEventUpdateRequest): Promise<TimelineEvent> {
    const response = await apiClient.put<ApiTimelineEvent>(
      `/api/v1/projects/${projectId}/timeline/events/${eventId}`,
      serializeEventUpdate(request),
    );
    return normalizeEvent(response);
  },

  async deleteEvent(projectId: string, eventId: string): Promise<void> {
    await apiClient.delete(`/api/v1/projects/${projectId}/timeline/events/${eventId}`);
  },

  async createEventLink(projectId: string, eventId: string, request: TimelineEventLinkRequest): Promise<TimelineEventLink> {
    const response = await apiClient.post<ApiTimelineEventLink>(
      `/api/v1/projects/${projectId}/timeline/events/${eventId}/links`,
      {
        object_type: request.objectType,
        object_id: request.objectId,
      },
    );
    return normalizeLink(response);
  },

  async deleteEventLink(projectId: string, eventId: string, linkId: string): Promise<void> {
    await apiClient.delete(`/api/v1/projects/${projectId}/timeline/events/${eventId}/links/${linkId}`);
  },

  async listLinksByObject(projectId: string, objectType: string, objectId: string): Promise<TimelineEventLink[]> {
    const query = buildQueryString({ object_type: objectType, object_id: objectId });
    const response = await apiClient.get<ApiTimelineEventLink[]>(`/api/v1/projects/${projectId}/timeline/links${query}`);
    return response.map(normalizeLink);
  },
};

export default timelineService;

import { apiClient } from './client';
import type {
  CalendarConfig,
  TimelineEventCreateRequest,
  TimelineEventLink,
  TimelineEventLinkRequest,
  TimelineEventUpdateRequest,
  TimelineTrackCreateRequest,
  TimelineTrackMoveRequest,
  TimelineTrackUpdateRequest,
} from '../types/timeline';
import type { TimelineObjectData, UnifiedObject } from '../types/unifiedObject';

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

type ApiTimelineEventLink = {
  id: string;
  event_id: string;
  object_type: string;
  object_id: string;
  created_at: string | null;
};

type ApiTimelineConfig = {
  id: string;
  project_id: string;
  calendar: CalendarConfig;
  warnings: string[];
};

export type TimelineConfig = {
  id: string;
  projectId: string;
  calendar: CalendarConfig;
  warnings: string[];
};

function normalizeLink(link: ApiTimelineEventLink): TimelineEventLink {
  return {
    id: link.id,
    eventId: link.event_id,
    objectType: link.object_type,
    objectId: link.object_id,
    createdAt: link.created_at,
  };
}

function normalizeConfig(timeline: ApiTimelineConfig): TimelineConfig {
  return {
    id: timeline.id,
    projectId: timeline.project_id,
    calendar: timeline.calendar,
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
  if (request.color !== undefined) payload.color = request.color;
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
  async getTimelineConfig(projectId: string): Promise<TimelineConfig> {
    const response = await apiClient.get<ApiTimelineConfig>(`/api/v1/projects/${projectId}/timeline`);
    return normalizeConfig(response);
  },

  async createTrack(projectId: string, request: TimelineTrackCreateRequest): Promise<UnifiedObject<TimelineObjectData>> {
    return apiClient.post<UnifiedObject<TimelineObjectData>>(
      `/api/v1/projects/${projectId}/timeline/tracks`,
      serializeTrackCreate(request),
    );
  },

  async updateTrack(projectId: string, trackId: string, request: TimelineTrackUpdateRequest): Promise<UnifiedObject<TimelineObjectData>> {
    return apiClient.put<UnifiedObject<TimelineObjectData>>(
      `/api/v1/projects/${projectId}/timeline/tracks/${trackId}`,
      serializeTrackUpdate(request),
    );
  },

  async moveTrack(projectId: string, trackId: string, request: TimelineTrackMoveRequest): Promise<UnifiedObject<TimelineObjectData>> {
    return apiClient.patch<UnifiedObject<TimelineObjectData>>(
      `/api/v1/projects/${projectId}/timeline/tracks/${trackId}/move`,
      {
        parent_id: request.parentId ?? null,
        position: request.position,
      },
    );
  },

  async deleteTrack(projectId: string, trackId: string): Promise<void> {
    await apiClient.delete(`/api/v1/projects/${projectId}/timeline/tracks/${trackId}`);
  },

  async updateCalendar(projectId: string, calendar: CalendarConfig): Promise<TimelineConfig> {
    const response = await apiClient.put<ApiTimelineConfig>(
      `/api/v1/projects/${projectId}/timeline/calendar`,
      { calendar },
    );
    return normalizeConfig(response);
  },

  async createEvent(projectId: string, request: TimelineEventCreateRequest): Promise<UnifiedObject<TimelineObjectData>> {
    return apiClient.post<UnifiedObject<TimelineObjectData>>(
      `/api/v1/projects/${projectId}/timeline/events`,
      serializeEventCreate(request),
    );
  },

  async updateEvent(projectId: string, eventId: string, request: TimelineEventUpdateRequest): Promise<UnifiedObject<TimelineObjectData>> {
    return apiClient.put<UnifiedObject<TimelineObjectData>>(
      `/api/v1/projects/${projectId}/timeline/events/${eventId}`,
      serializeEventUpdate(request),
    );
  },

  async deleteEvent(projectId: string, eventId: string): Promise<void> {
    await apiClient.delete(`/api/v1/projects/${projectId}/timeline/events/${eventId}`);
  },

  async createEventLink(projectId: string, eventId: string, request: TimelineEventLinkRequest, language?: string): Promise<UnifiedObject<TimelineObjectData>> {
    const query = buildQueryString({ language });
    return apiClient.post<UnifiedObject<TimelineObjectData>>(
      `/api/v1/projects/${projectId}/timeline/events/${eventId}/links${query}`,
      {
        object_type: request.objectType,
        object_id: request.objectId,
      },
    );
  },

  async deleteEventLink(projectId: string, eventId: string, linkId: string, language?: string): Promise<UnifiedObject<TimelineObjectData>> {
    const query = buildQueryString({ language });
    return apiClient.delete<UnifiedObject<TimelineObjectData>>(`/api/v1/projects/${projectId}/timeline/events/${eventId}/links/${linkId}${query}`);
  },

  async listLinksByObject(projectId: string, objectType: string, objectId: string): Promise<TimelineEventLink[]> {
    const query = buildQueryString({ object_type: objectType, object_id: objectId });
    const response = await apiClient.get<ApiTimelineEventLink[]>(`/api/v1/projects/${projectId}/timeline/links${query}`);
    return response.map(normalizeLink);
  },
};

export default timelineService;

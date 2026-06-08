import { OBJECT_TYPE_CONFIG } from './objectTypeConfig';
import type { TipTapDoc } from './tiptap';
import type { AnyObjectType, ObjectType, TimelineObjectType } from './unifiedObject';

export interface CalendarUnit {
  name: string;
  label: string;
  count?: number;
}

export interface CalendarConfig {
  units: CalendarUnit[];
}

export type TimelineDate = Record<string, number>;

export interface TimelineVersionInfo {
  id: string | null;
  number: number;
  createdAt: string | null;
}

export interface TimelineEventLink {
  id: string;
  eventId: string;
  objectType: string;
  objectId: string;
  createdAt: string | null;
}

export interface TimelineEvent {
  id: string;
  trackId: string;
  startDate: TimelineDate;
  endDate?: TimelineDate | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
  data: Record<string, Record<string, unknown>>;
  version: TimelineVersionInfo;
  links: TimelineEventLink[];
}

export interface TimelineTrack {
  id: string;
  timelineId: string;
  parentId?: string | null;
  position: number;
  color?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  data: Record<string, Record<string, unknown>>;
  version: TimelineVersionInfo;
  events: TimelineEvent[];
  children: TimelineTrack[];
}

export interface FullTimeline {
  id: string;
  projectId: string;
  calendar: CalendarConfig;
  tracks: TimelineTrack[];
  warnings: string[];
}

export const TIMELINE_OBJECT_TYPE_CONFIG: Record<TimelineObjectType, { label: string; order: number }> = {
  timeline_track: { label: 'Timeline Track', order: 2.1 },
  timeline_event: { label: 'Timeline Event', order: 2.2 },
};

export function isTimelineObjectType(type: string): type is TimelineObjectType {
  return type === 'timeline_track' || type === 'timeline_event';
}

export function getAnyObjectTypeLabel(type: AnyObjectType): string {
  if (isTimelineObjectType(type)) {
    return TIMELINE_OBJECT_TYPE_CONFIG[type].label;
  }
  return OBJECT_TYPE_CONFIG[type as ObjectType]?.label || type;
}

export function getAnyObjectTypeOrder(type: AnyObjectType): number {
  if (isTimelineObjectType(type)) {
    return TIMELINE_OBJECT_TYPE_CONFIG[type].order;
  }
  return OBJECT_TYPE_CONFIG[type as ObjectType]?.order ?? 999;
}

export interface TimelineTrackCreateRequest {
  language: string;
  name: string;
  description?: string;
  content?: TipTapDoc;
  parentId?: string | null;
  position?: number;
  color?: string | null;
  userRequest?: string;
}

export interface TimelineTrackUpdateRequest {
  language?: string;
  name?: string;
  description?: string;
  content?: TipTapDoc;
  color?: string | null;
  userRequest?: string;
  createNewVersion?: boolean;
}

export interface TimelineTrackMoveRequest {
  parentId?: string | null;
  position?: number;
}

export interface TimelineEventCreateRequest {
  trackId: string;
  language: string;
  name: string;
  description?: string;
  content?: TipTapDoc;
  startDate: TimelineDate;
  endDate?: TimelineDate | null;
  tags?: string[];
  userRequest?: string;
}

export interface TimelineEventUpdateRequest {
  trackId?: string;
  language?: string;
  name?: string;
  description?: string;
  content?: TipTapDoc;
  startDate?: TimelineDate;
  endDate?: TimelineDate | null;
  tags?: string[];
  userRequest?: string;
  createNewVersion?: boolean;
}

export interface TimelineEventLinkRequest {
  objectType: string;
  objectId: string;
}

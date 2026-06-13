import { OBJECT_TYPE_CONFIG } from './objectTypeConfig';
import type { TipTapDoc } from './tiptap';
import type { AnyObjectType, LanguageState, ObjectType, TimelineObjectType } from './unifiedObject';

export interface CalendarUnit {
  name: string;
  label: string;
  count?: number;
}

export interface CalendarConfig {
  mode?: 'fixed' | 'gregorian';
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
  data: Record<string, unknown>;
  languageState?: LanguageState;
  version: TimelineVersionInfo;
  links: TimelineEventLink[];
}

export interface TimelineTrack {
  id: string;
  timelineId: string;
  parentId?: string | null;
  position: number;
  /** canonical oklch string, assigned server-side when not chosen manually */
  color: string;
  createdAt: string | null;
  updatedAt: string | null;
  data: Record<string, unknown>;
  languageState?: LanguageState;
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
  timeline_track: OBJECT_TYPE_CONFIG.timeline_track,
  timeline_event: OBJECT_TYPE_CONFIG.timeline_event,
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
  /** null/omitted = server assigns an automatic color */
  color?: string | null;
  userRequest?: string;
}

export interface TimelineTrackUpdateRequest {
  language?: string;
  name?: string;
  description?: string;
  content?: TipTapDoc;
  /** omitted = keep current color; cannot be cleared */
  color?: string;
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
  links?: TimelineEventLinkRequest[];
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

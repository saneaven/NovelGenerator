/**
 * Notification domain: types + pure functions.
 *
 * Single home for the notification shape and every pure transform/derivation.
 * `normalizeNotification` parses a server DTO into a strongly-typed entry (or
 * null when the source/status combo is invalid); the higher-level helpers map,
 * key, sort, and derive flags over collections of those entries. No React, no
 * store, no I/O — so both the query layer and the SSE bridge can reuse them.
 */

import type {
  NotificationDTO,
  NotificationSourceDTO,
  NotificationSourceKind,
  NotificationStatus as ServerNotificationStatus,
  NotificationTargetDTO,
} from '../api/notificationService';

export type NotificationStatus = ServerNotificationStatus | 'idle';
export type NotificationServerDTO = NotificationDTO;
export type NotificationMeta = Record<string, unknown> | null;
export type NotificationSourceKindType = NotificationSourceKind;
export type NotificationTarget = NotificationTargetDTO;

export type JourneyNotificationStatus =
  Extract<ServerNotificationStatus, 'running' | 'waiting' | 'processing' | 'ready' | 'paused' | 'done' | 'error' | 'canceled'>;
export type ImageRunNotificationStatus =
  Extract<ServerNotificationStatus, 'queued' | 'running' | 'review' | 'applying' | 'applied' | 'rejected' | 'failed' | 'canceled'>;
export type SystemNotificationStatus =
  Extract<ServerNotificationStatus, 'running' | 'done' | 'error' | 'canceled'>;
export type AgentNotificationStatus =
  Extract<ServerNotificationStatus, 'running' | 'waiting' | 'processing' | 'ready' | 'paused' | 'done' | 'error' | 'canceled'>;

export type JourneyNotificationSource = NotificationSourceDTO & {
  kind: 'journey';
  thread_id?: string | null;
  run_id?: string | null;
  journey_kind?: string | null;
};

export type ImageRunNotificationSource = NotificationSourceDTO & {
  kind: 'imageRun';
  thread_id?: string | null;
  tool_call_id?: string | null;
  review_mode?: 'auto' | 'manual' | null;
};

export type SystemNotificationSource = NotificationSourceDTO & {
  kind: 'system';
};

export type AgentNotificationSource = NotificationSourceDTO & {
  kind: 'agent';
  thread_id?: string | null;
  agent_id?: string | null;
};

export type SubAgentNotificationSource = NotificationSourceDTO & {
  kind: 'subAgent';
  thread_id?: string | null;
};

export type NotificationSource =
  | JourneyNotificationSource
  | ImageRunNotificationSource
  | SystemNotificationSource
  | AgentNotificationSource
  | SubAgentNotificationSource;

export interface NotificationProgress {
  current?: number;
  total?: number;
  stage?: string;
  label?: string;
  percentage?: number;
}

export type NotificationCustomSlot =
  | { type: 'none' }
  | { type: 'image'; url: string; alt?: string };

interface NotificationEntryBase<S extends NotificationSource, T extends ServerNotificationStatus> {
  id: string;
  projectId: string | null;
  source: S;
  target: NotificationTarget;
  important: boolean;
  status: T;
  label: string;
  message: string;
  warning?: string;
  progress?: NotificationProgress;
  customSlot: NotificationCustomSlot;
  meta: NotificationMeta;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}

export type JourneyNotificationEntry = NotificationEntryBase<JourneyNotificationSource, JourneyNotificationStatus>;
export type ImageRunNotificationEntry = NotificationEntryBase<ImageRunNotificationSource, ImageRunNotificationStatus>;
export type SystemNotificationEntry = NotificationEntryBase<SystemNotificationSource, SystemNotificationStatus>;
export type AgentNotificationEntry = NotificationEntryBase<AgentNotificationSource, AgentNotificationStatus>;
export type SubAgentNotificationEntry = NotificationEntryBase<SubAgentNotificationSource, AgentNotificationStatus>;

export type NotificationEntry =
  | JourneyNotificationEntry
  | ImageRunNotificationEntry
  | SystemNotificationEntry
  | AgentNotificationEntry
  | SubAgentNotificationEntry;

function toTimestamp(value: string | null | undefined): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toCustomSlot(value: NotificationServerDTO['custom_slot']): NotificationCustomSlot {
  if (!value || value.type !== 'image') {
    return { type: 'none' };
  }
  const url = String(value.url || '').trim();
  if (!url) {
    return { type: 'none' };
  }
  const alt = typeof value.alt === 'string' ? value.alt : undefined;
  return { type: 'image', url, alt };
}

const JOURNEY_STATUSES = [
  'running',
  'waiting',
  'processing',
  'ready',
  'paused',
  'done',
  'error',
  'canceled',
 ] as const;

const IMAGE_RUN_STATUSES = [
  'queued',
  'running',
  'review',
  'applying',
  'applied',
  'rejected',
  'failed',
  'canceled',
 ] as const;

const SYSTEM_STATUSES = [
  'running',
  'done',
  'error',
  'canceled',
 ] as const;

function isJourneyStatus(value: string): value is JourneyNotificationEntry['status'] {
  return (JOURNEY_STATUSES as readonly string[]).includes(value);
}

function isImageRunStatus(value: string): value is ImageRunNotificationEntry['status'] {
  return (IMAGE_RUN_STATUSES as readonly string[]).includes(value);
}

function isSystemStatus(value: string): value is SystemNotificationEntry['status'] {
  return (SYSTEM_STATUSES as readonly string[]).includes(value);
}

const AGENT_STATUSES = [
  'running',
  'waiting',
  'processing',
  'ready',
  'paused',
  'done',
  'error',
  'canceled',
] as const;

function isAgentStatus(value: string): value is AgentNotificationEntry['status'] {
  return (AGENT_STATUSES as readonly string[]).includes(value);
}

function toEntryBase(dto: NotificationServerDTO) {
  return {
    id: String(dto.id),
    projectId: dto.project_id ? String(dto.project_id) : null,
    target: {
      kind: dto.target?.kind ?? 'none',
      project_id: dto.target?.project_id ? String(dto.target.project_id) : null,
      thread_id: dto.target?.thread_id ? String(dto.target.thread_id) : null,
      journey_id: dto.target?.journey_id ? String(dto.target.journey_id) : null,
      agent_id: dto.target?.agent_id ? String(dto.target.agent_id) : null,
    },
    important: Boolean(dto.important),
    label: String(dto.label || 'Notification'),
    message: String(dto.message || ''),
    warning: dto.warning ? String(dto.warning) : undefined,
    progress: dto.progress
      ? {
          current: dto.progress.current ?? undefined,
          total: dto.progress.total ?? undefined,
          stage: dto.progress.stage ?? undefined,
          label: dto.progress.label ?? undefined,
          percentage: dto.progress.percentage ?? undefined,
        }
      : undefined,
    customSlot: toCustomSlot(dto.custom_slot),
    meta: dto.meta && typeof dto.meta === 'object' ? dto.meta : null,
    isRead: Boolean(dto.is_read),
    createdAt: toTimestamp(dto.created_at),
    updatedAt: toTimestamp(dto.updated_at),
  };
}

/** Parse a server DTO into a typed entry, or null when source/status is invalid. */
export function normalizeNotification(dto: NotificationServerDTO): NotificationEntry | null {
  const base = toEntryBase(dto);
  const status = String(dto.status || '').trim();
  const source = dto.source;

  if (source.kind === 'journey' && isJourneyStatus(status)) {
    const entry: JourneyNotificationEntry = {
      ...base,
      source: {
        kind: 'journey',
        id: String(source.id),
        thread_id: source.thread_id ? String(source.thread_id) : null,
        run_id: source.run_id ? String(source.run_id) : null,
        journey_kind: source.journey_kind ? String(source.journey_kind) : null,
      },
      status,
    };
    return entry;
  }

  if (source.kind === 'imageRun' && isImageRunStatus(status)) {
    const reviewMode = source.review_mode === 'auto' || source.review_mode === 'manual'
      ? source.review_mode
      : null;
    const entry: ImageRunNotificationEntry = {
      ...base,
      source: {
        kind: 'imageRun',
        id: String(source.id),
        thread_id: source.thread_id ? String(source.thread_id) : null,
        tool_call_id: source.tool_call_id ? String(source.tool_call_id) : null,
        review_mode: reviewMode,
      },
      status,
    };
    return entry;
  }

  if (source.kind === 'system' && isSystemStatus(status)) {
    const entry: SystemNotificationEntry = {
      ...base,
      source: {
        kind: 'system',
        id: String(source.id),
      },
      status,
    };
    return entry;
  }

  if (source.kind === 'agent' && isAgentStatus(status)) {
    const entry: AgentNotificationEntry = {
      ...base,
      source: {
        kind: 'agent',
        id: String(source.id),
        thread_id: source.thread_id ? String(source.thread_id) : null,
        agent_id: source.agent_id ? String(source.agent_id) : null,
      },
      status,
    };
    return entry;
  }

  if (source.kind === 'subAgent' && isAgentStatus(status)) {
    const entry: SubAgentNotificationEntry = {
      ...base,
      source: {
        kind: 'subAgent',
        id: String(source.id),
        thread_id: source.thread_id ? String(source.thread_id) : null,
      },
      status,
    };
    return entry;
  }

  if (import.meta.env.DEV) {
    console.warn('Dropping invalid notification payload', { sourceKind: source.kind, status, dto });
  }
  return null;
}

/** Normalize a batch of DTOs, dropping any that fail validation. */
export function normalizeNotifications(dtos: NotificationDTO[]): NotificationEntry[] {
  return dtos
    .map((dto) => normalizeNotification(dto))
    .filter((entry): entry is NotificationEntry => entry !== null);
}

/** Normalize a batch of DTOs into an id-keyed map. */
export function notificationsToRecord(dtos: NotificationDTO[]): Record<string, NotificationEntry> {
  const record: Record<string, NotificationEntry> = {};
  for (const entry of normalizeNotifications(dtos)) {
    record[entry.id] = entry;
  }
  return record;
}

/** Sort entries: important desc, isRead asc, updatedAt desc, createdAt desc, id desc. */
export function sortNotifications(entries: NotificationEntry[]): NotificationEntry[] {
  return [...entries].sort((a, b) => {
    if (a.important !== b.important) return Number(b.important) - Number(a.important);
    if (a.isRead !== b.isRead) return Number(a.isRead) - Number(b.isRead);
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return b.id.localeCompare(a.id);
  });
}

/** True when any entry is unread. */
export function hasUnreadNotifications(entries: NotificationEntry[]): boolean {
  return entries.some((entry) => !entry.isRead);
}

/** True when any entry is in an in-progress (running/queued/applying/processing) state. */
export function hasRunningNotifications(entries: NotificationEntry[]): boolean {
  return entries.some(
    (entry) =>
      (entry.source.kind === 'journey' && (entry.status === 'running' || entry.status === 'processing'))
      || (entry.source.kind === 'imageRun' && (entry.status === 'queued' || entry.status === 'running' || entry.status === 'applying'))
      || (entry.source.kind === 'system' && entry.status === 'running')
      || (entry.source.kind === 'agent' && (entry.status === 'running' || entry.status === 'processing'))
      || (entry.source.kind === 'subAgent' && (entry.status === 'running' || entry.status === 'processing')),
  );
}

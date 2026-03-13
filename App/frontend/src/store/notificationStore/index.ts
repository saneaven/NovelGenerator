import { create } from 'zustand';
import type { NotificationCustomSlot, NotificationEntry, NotificationServerDTO } from './types';

interface NotificationStore {
  notifications: Record<string, NotificationEntry | undefined>;
  detailNotificationId: string | null;

  hydrate: (items: NotificationServerDTO[]) => void;
  upsertFromServer: (item: NotificationServerDTO) => void;
  restoreEntries: (items: NotificationEntry[], detailNotificationId?: string | null) => void;
  removeFromServer: (id: string) => void;
  removeManyFromServer: (ids: string[]) => void;
  markReadLocal: (ids: string[]) => void;
  markAllReadLocal: () => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;

  getNotification: (id: string) => NotificationEntry | undefined;
  getSortedNotifications: () => NotificationEntry[];
  hasUnread: () => boolean;
  hasRunning: () => boolean;
}

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

function toEntry(dto: NotificationServerDTO): NotificationEntry {
  return {
    id: String(dto.id),
    projectId: dto.project_id ? String(dto.project_id) : null,
    source: {
      kind: dto.source.kind,
      id: String(dto.source.id),
    },
    target: {
      kind: dto.target?.kind ?? 'none',
      project_id: dto.target?.project_id ? String(dto.target.project_id) : null,
      thread_id: dto.target?.thread_id ? String(dto.target.thread_id) : null,
      journey_id: dto.target?.journey_id ? String(dto.target.journey_id) : null,
    },
    important: Boolean(dto.important),
    status: dto.status,
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

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: {},
  detailNotificationId: null,

  hydrate: (items) =>
    set((state) => {
      const next: Record<string, NotificationEntry | undefined> = {};
      for (const item of items) {
        const normalized = toEntry(item);
        next[normalized.id] = normalized;
      }

      const shouldCloseDetail = state.detailNotificationId !== null && !next[state.detailNotificationId];
      return {
        notifications: next,
        detailNotificationId: shouldCloseDetail ? null : state.detailNotificationId,
      };
    }),

  upsertFromServer: (item) =>
    set((state) => {
      const normalized = toEntry(item);
      return {
        notifications: {
          ...state.notifications,
          [normalized.id]: normalized,
        },
      };
    }),

  restoreEntries: (items, restoreDetailNotificationId = null) =>
    set((state) => {
      if (!items.length) return state;
      const next = { ...state.notifications };
      for (const item of items) {
        next[item.id] = item;
      }
      const shouldRestoreDetail =
        restoreDetailNotificationId !== null &&
        items.some((item) => item.id === restoreDetailNotificationId);
      return {
        notifications: next,
        detailNotificationId: shouldRestoreDetail
          ? restoreDetailNotificationId
          : state.detailNotificationId,
      };
    }),

  removeFromServer: (id) =>
    set((state) => {
      if (!state.notifications[id]) return state;
      const { [id]: _ignored, ...rest } = state.notifications;
      return {
        notifications: rest,
        detailNotificationId: state.detailNotificationId === id ? null : state.detailNotificationId,
      };
    }),

  removeManyFromServer: (ids) =>
    set((state) => {
      if (!ids.length) return state;
      const toDelete = new Set(ids);
      let changed = false;
      const next: Record<string, NotificationEntry | undefined> = {};
      for (const [id, entry] of Object.entries(state.notifications)) {
        if (toDelete.has(id)) {
          changed = true;
          continue;
        }
        next[id] = entry;
      }
      if (!changed) return state;
      const shouldCloseDetail =
        state.detailNotificationId !== null && toDelete.has(state.detailNotificationId);
      return {
        notifications: next,
        detailNotificationId: shouldCloseDetail ? null : state.detailNotificationId,
      };
    }),

  markReadLocal: (ids) =>
    set((state) => {
      if (!ids.length) return state;
      const toMark = new Set(ids);
      let changed = false;
      const next: Record<string, NotificationEntry | undefined> = {};
      for (const [id, entry] of Object.entries(state.notifications)) {
        if (!entry) {
          next[id] = entry;
          continue;
        }
        if (!toMark.has(id) || entry.isRead) {
          next[id] = entry;
          continue;
        }
        changed = true;
        next[id] = { ...entry, isRead: true };
      }
      return changed ? { notifications: next } : state;
    }),

  markAllReadLocal: () =>
    set((state) => {
      let changed = false;
      const next: Record<string, NotificationEntry | undefined> = {};
      for (const [id, entry] of Object.entries(state.notifications)) {
        if (!entry || entry.isRead) {
          next[id] = entry;
          continue;
        }
        changed = true;
        next[id] = { ...entry, isRead: true };
      }
      return changed ? { notifications: next } : state;
    }),

  openDetail: (id) =>
    set((state) => {
      if (!state.notifications[id]) return state;
      return { detailNotificationId: id };
    }),

  closeDetail: () => set({ detailNotificationId: null }),

  getNotification: (id) => get().notifications[id],

  getSortedNotifications: () =>
    Object.values(get().notifications)
      .filter((entry): entry is NotificationEntry => entry !== undefined)
      .sort((a, b) => {
        if (a.important !== b.important) return Number(b.important) - Number(a.important);
        if (a.isRead !== b.isRead) return Number(a.isRead) - Number(b.isRead);
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
        if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
        return b.id.localeCompare(a.id);
      }),

  hasUnread: () =>
    Object.values(get().notifications).some(
      (entry) => entry !== undefined && !entry.isRead,
    ),

  hasRunning: () =>
    Object.values(get().notifications).some(
      (entry) => entry !== undefined && entry.status === 'running',
    ),
}));

export type { NotificationEntry, NotificationServerDTO } from './types';
export type { NotificationStatus, NotificationCustomSlot, NotificationProgress } from './types';

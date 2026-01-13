import { create } from 'zustand';
import type {
  NotificationData,
  NotificationEntry,
  NotificationHandlers,
  ModalRenderer,
} from './types';

interface NotificationStore {
  // State
  notifications: Record<string, NotificationEntry | undefined>;
  modalRenderers: Record<string, ModalRenderer>;

  // Registration API
  register: (data: NotificationData, handlers: NotificationHandlers) => void;

  // Update API
  update: (
    id: string,
    partial: Partial<Omit<NotificationData, 'id' | 'source' | 'createdAt'>>
  ) => void;

  // Removal API
  remove: (id: string) => void;
  removeAll: () => void;
  removeBySource: (source: string) => void;

  // Query helpers
  getNotification: (id: string) => NotificationEntry | undefined;
  getNotificationsBySource: (source: string) => NotificationEntry[];
  getActiveNotifications: () => NotificationEntry[];
  getSortedNotifications: () => NotificationEntry[];

  // Notification state
  hasUnread: () => boolean;
  hasRunning: () => boolean;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;

  // Handler invocation (used by components)
  invokeHandler: (id: string, handler: keyof NotificationHandlers) => void;

  // Modal registry (for consumer-registered modals)
  registerModalRenderer: (source: string, render: ModalRenderer) => void;
  unregisterModalRenderer: (source: string) => void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: {},
  modalRenderers: {},

  register: (data, handlers) =>
    set((state) => ({
      notifications: {
        ...state.notifications,
        [data.id]: { ...data, handlers },
      },
    })),

  update: (id, partial) =>
    set((state) => {
      const existing = state.notifications[id];
      if (!existing) return state;
      return {
        notifications: {
          ...state.notifications,
          [id]: {
            ...existing,
            ...partial,
          },
        },
      };
    }),

  remove: (id) => {
    const existing = get().notifications[id];
    if (!existing) return;

    // First update state (remove notification)
    set((state) => {
      const { [id]: _, ...rest } = state.notifications;
      return { notifications: rest };
    });

    // Then call the handler (after state is updated)
    existing.handlers.onDismiss?.();
  },

  removeAll: () => {
    const { notifications } = get();
    // Invoke all dismiss handlers
    Object.values(notifications).forEach((n) => n?.handlers.onDismiss?.());
    set({ notifications: {} });
  },

  removeBySource: (source) => {
    const { notifications } = get();
    const toRemove: NotificationEntry[] = [];
    const filtered: Record<string, NotificationEntry | undefined> = {};

    for (const [id, entry] of Object.entries(notifications)) {
      if (entry && entry.source !== source) {
        filtered[id] = entry;
      } else if (entry) {
        toRemove.push(entry);
      }
    }

    // Update state first
    set({ notifications: filtered });

    // Then invoke handlers
    toRemove.forEach((entry) => entry.handlers.onDismiss?.());
  },

  getNotification: (id) => get().notifications[id],

  getNotificationsBySource: (source) =>
    Object.values(get().notifications).filter(
      (n): n is NotificationEntry => n !== undefined && n.source === source
    ),

  getActiveNotifications: () =>
    Object.values(get().notifications).filter(
      (n): n is NotificationEntry => n !== undefined && n.status !== 'idle'
    ),

  getSortedNotifications: () =>
    Object.values(get().notifications)
      .filter((n): n is NotificationEntry => n !== undefined && n.status !== 'idle')
      .sort((a, b) => b.createdAt - a.createdAt),

  hasUnread: () =>
    Object.values(get().notifications).some(
      (n) => n !== undefined && n.status !== 'idle' && !n.isRead
    ),

  hasRunning: () =>
    Object.values(get().notifications).some(
      (n) => n !== undefined && n.status === 'running'
    ),

  markAsRead: (id) =>
    set((state) => {
      const existing = state.notifications[id];
      if (!existing) return state;
      return {
        notifications: {
          ...state.notifications,
          [id]: { ...existing, isRead: true },
        },
      };
    }),

  markAllAsRead: () =>
    set((state) => {
      const updated: Record<string, NotificationEntry | undefined> = {};
      for (const [id, entry] of Object.entries(state.notifications)) {
        if (entry) {
          updated[id] = { ...entry, isRead: true };
        }
      }
      return { notifications: updated };
    }),

  invokeHandler: (id, handler) => {
    const entry = get().notifications[id];
    if (entry?.handlers[handler]) {
      entry.handlers[handler]!();
    }
  },

  registerModalRenderer: (source, render) =>
    set((state) => ({
      modalRenderers: { ...state.modalRenderers, [source]: render },
    })),

  unregisterModalRenderer: (source) =>
    set((state) => {
      const { [source]: _, ...rest } = state.modalRenderers;
      return { modalRenderers: rest };
    }),
}));

// Re-export types
export type { NotificationData, NotificationEntry, NotificationHandlers, ModalRenderer } from './types';
export type { NotificationStatus, NotificationCustomSlot, NotificationProgress } from './types';

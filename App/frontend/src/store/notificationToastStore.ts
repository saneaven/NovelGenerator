import { create } from 'zustand';
import type { NotificationSourceKind } from '../api/notificationService';
import type { NotificationStatus } from '../domain/notifications';

export type NotificationStatusToast = {
  id: string;
  label: string;
  message: string;
  sourceKind: NotificationSourceKind;
  status: NotificationStatus;
  updatedAt: number;
  durationMs?: number;
};

interface NotificationToastStore {
  activeToast: NotificationStatusToast | null;
  queue: NotificationStatusToast[];
  activityPanelOpen: boolean;

  show: (toast: NotificationStatusToast, durationMs?: number) => void;
  dismissActive: () => void;
  clear: () => void;
  setActivityPanelOpen: (open: boolean) => void;
}

let toastTimeoutId: number | null = null;
let activateNextToast: (() => void) | null = null;

function clearToastTimer(): void {
  if (toastTimeoutId !== null) {
    window.clearTimeout(toastTimeoutId);
    toastTimeoutId = null;
  }
}

export const useNotificationToastStore = create<NotificationToastStore>()((set, get) => ({
  activeToast: null,
  queue: [],
  activityPanelOpen: false,

  show: (toast, durationMs = 2500) => {
    if (get().activityPanelOpen) return;
    const nextToast = { ...toast, durationMs };
    const state = get();
    if (state.activeToast === null) {
      set({ activeToast: nextToast });
      clearToastTimer();
      toastTimeoutId = window.setTimeout(() => {
        clearToastTimer();
        activateNextToast?.();
      }, durationMs);
      return;
    }
    set((current) => ({ queue: [...current.queue, nextToast] }));
  },

  dismissActive: () => {
    clearToastTimer();
    activateNextToast?.();
  },

  clear: () => {
    clearToastTimer();
    set({ activeToast: null, queue: [] });
  },

  setActivityPanelOpen: (open) => {
    set({ activityPanelOpen: open });
    if (open) {
      get().clear();
    }
  },
}));

activateNextToast = () => {
  const { queue } = useNotificationToastStore.getState();
  if (queue.length === 0) {
    useNotificationToastStore.setState({ activeToast: null });
    return;
  }
  const [nextToast, ...rest] = queue;
  useNotificationToastStore.setState({ activeToast: nextToast, queue: rest });
  clearToastTimer();
  toastTimeoutId = window.setTimeout(() => {
    clearToastTimer();
    activateNextToast?.();
  }, nextToast.durationMs);
};


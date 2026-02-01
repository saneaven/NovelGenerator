import { create } from 'zustand';
import type { NotificationStatus } from './notificationStore';

export type NotificationStatusToast = {
  id: string;
  label: string;
  message: string;
  status: NotificationStatus;
  updatedAt: number;
};

interface NotificationToastStore {
  toast: NotificationStatusToast | null;
  activityPanelOpen: boolean;

  show: (toast: NotificationStatusToast, durationMs?: number) => void;
  clear: () => void;
  setActivityPanelOpen: (open: boolean) => void;
}

let toastTimeoutId: number | null = null;

export const useNotificationToastStore = create<NotificationToastStore>()((set, get) => ({
  toast: null,
  activityPanelOpen: false,

  show: (toast, durationMs = 2500) => {
    if (get().activityPanelOpen) return;

    if (toastTimeoutId !== null) {
      window.clearTimeout(toastTimeoutId);
      toastTimeoutId = null;
    }

    set({ toast });

    toastTimeoutId = window.setTimeout(() => {
      toastTimeoutId = null;
      set({ toast: null });
    }, durationMs);
  },

  clear: () => {
    if (toastTimeoutId !== null) {
      window.clearTimeout(toastTimeoutId);
      toastTimeoutId = null;
    }
    set({ toast: null });
  },

  setActivityPanelOpen: (open) => {
    set({ activityPanelOpen: open });
    if (open) {
      get().clear();
    }
  },
}));


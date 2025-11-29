import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'info';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
}

interface ErrorStore {
  currentError: Notification | null;
  showNotification: (type: NotificationType, title: string, message: string) => void;
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
  hideError: () => void;
}

export const useErrorStore = create<ErrorStore>((set) => ({
  currentError: null,

  showNotification: (type: NotificationType, title: string, message: string) => {
    set({
      currentError: {
        id: crypto.randomUUID(),
        type,
        title,
        message
      }
    });
  },

  showSuccess: (title: string, message: string) => {
    set({
      currentError: {
        id: crypto.randomUUID(),
        type: 'success',
        title,
        message
      }
    });
  },

  showError: (title: string, message: string) => {
    set({
      currentError: {
        id: crypto.randomUUID(),
        type: 'error',
        title,
        message
      }
    });
  },

  showInfo: (title: string, message: string) => {
    set({
      currentError: {
        id: crypto.randomUUID(),
        type: 'info',
        title,
        message
      }
    });
  },

  hideError: () => {
    set({ currentError: null });
  }
}));

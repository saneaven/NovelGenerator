import { create } from 'zustand';
import { generateTempId } from '../utils/tempId';

export type NotificationType = 'success' | 'error' | 'info';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  detail?: string | null;
}

interface ErrorStore {
  currentError: Notification | null;
  showNotification: (type: NotificationType, title: string, message: string, detail?: string | null) => void;
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string, detail?: string | null) => void;
  showInfo: (title: string, message: string) => void;
  hideError: () => void;
}

export const useErrorStore = create<ErrorStore>((set) => ({
  currentError: null,

  showNotification: (type: NotificationType, title: string, message: string, detail?: string | null) => {
    set({
      currentError: {
        id: generateTempId(),
        type,
        title,
        message,
        detail
      }
    });
  },

  showSuccess: (title: string, message: string) => {
    set({
      currentError: {
        id: generateTempId(),
        type: 'success',
        title,
        message
      }
    });
  },

  showError: (title: string, message: string, detail?: string | null) => {
    set({
      currentError: {
        id: generateTempId(),
        type: 'error',
        title,
        message,
        detail
      }
    });
  },

  showInfo: (title: string, message: string) => {
    set({
      currentError: {
        id: generateTempId(),
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

import { create } from 'zustand';
import { generateTempId } from '../utils/tempId';

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
        id: generateTempId(),
        type,
        title,
        message
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

  showError: (title: string, message: string) => {
    set({
      currentError: {
        id: generateTempId(),
        type: 'error',
        title,
        message
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

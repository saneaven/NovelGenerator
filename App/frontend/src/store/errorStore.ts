import { create } from 'zustand';

interface ErrorModal {
  id: string;
  title: string;
  message: string;
}

interface ErrorStore {
  currentError: ErrorModal | null;
  showError: (title: string, message: string) => void;
  hideError: () => void;
}

export const useErrorStore = create<ErrorStore>((set) => ({
  currentError: null,

  showError: (title: string, message: string) => {
    set({
      currentError: {
        id: crypto.randomUUID(),
        title,
        message
      }
    });
  },

  hideError: () => {
    set({ currentError: null });
  }
}));
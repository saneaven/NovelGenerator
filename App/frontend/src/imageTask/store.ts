import { create } from 'zustand';
import type { ImageTaskSession } from './types';

interface ImageTaskStore {
  sessions: Record<string, ImageTaskSession | undefined>;
  detailTaskId: string | null;

  createSession: (session: ImageTaskSession) => void;
  updateSession: (id: string, patch: Partial<ImageTaskSession>) => void;
  clearSession: (id: string) => void;

  openDetailModal: (id: string) => void;
  closeDetailModal: () => void;
}

export const useImageTaskStore = create<ImageTaskStore>((set) => ({
  sessions: {},
  detailTaskId: null,

  createSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
    })),

  updateSession: (id, patch) =>
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            ...patch,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  clearSession: (id) =>
    set((state) => {
      if (!state.sessions[id]) return state;
      const next = { ...state.sessions };
      delete next[id];
      return { sessions: next };
    }),

  openDetailModal: (id) => set({ detailTaskId: id }),
  closeDetailModal: () => set({ detailTaskId: null }),
}));

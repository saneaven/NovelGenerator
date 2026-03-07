import { create } from 'zustand';
import type { ImageRun } from '../api/assetService';

interface ImageRunStore {
  runsById: Record<string, ImageRun | undefined>;
  upsertRun: (run: ImageRun) => void;
  upsertRuns: (runs: ImageRun[]) => void;
  clearRun: (id: string) => void;
  clearAll: () => void;
}

export const useImageRunStore = create<ImageRunStore>((set) => ({
  runsById: {},

  upsertRun: (run) =>
    set((state) => ({
      runsById: {
        ...state.runsById,
        [run.id]: run,
      },
    })),

  upsertRuns: (runs) =>
    set((state) => {
      if (runs.length === 0) return state;
      const next = { ...state.runsById };
      for (const run of runs) next[run.id] = run;
      return { runsById: next };
    }),

  clearRun: (id) =>
    set((state) => {
      if (!state.runsById[id]) return state;
      const next = { ...state.runsById };
      delete next[id];
      return { runsById: next };
    }),

  clearAll: () => set({ runsById: {} }),
}));

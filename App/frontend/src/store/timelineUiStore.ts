import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Browser-only timeline UI state.
 *
 * Track visibility is an explicit-hidden set per project: hiding a parent hides
 * its whole subtree visually, but only the parent's id is stored, so unhiding
 * the parent restores each descendant's own explicit state.
 */
interface TimelineUiStore {
  hiddenTrackIdsByProject: Record<string, string[]>;
  /** content-hash of the last dismissed warnings banner (session only, not persisted) */
  dismissedWarningsKey: string | null;

  isTrackHidden: (projectId: string, trackId: string) => boolean;
  toggleTrackHidden: (projectId: string, trackId: string) => void;
  showAllTracks: (projectId: string) => void;
  /** remove every id along a path so a deep-linked / newly created event becomes visible */
  unhideAncestorChain: (projectId: string, trackPathIds: string[]) => void;
  /** drop ids that no longer exist after a refetch */
  pruneHiddenTracks: (projectId: string, existingTrackIds: ReadonlySet<string>) => void;
  setDismissedWarningsKey: (key: string | null) => void;
}

export const useTimelineUiStore = create<TimelineUiStore>()(
  persist(
    (set, get) => ({
      hiddenTrackIdsByProject: {},
      dismissedWarningsKey: null,

      isTrackHidden: (projectId, trackId) =>
        (get().hiddenTrackIdsByProject[projectId] ?? []).includes(trackId),

      toggleTrackHidden: (projectId, trackId) => {
        set((state) => {
          const current = state.hiddenTrackIdsByProject[projectId] ?? [];
          const next = current.includes(trackId)
            ? current.filter((id) => id !== trackId)
            : [...current, trackId];
          return {
            hiddenTrackIdsByProject: { ...state.hiddenTrackIdsByProject, [projectId]: next },
          };
        });
      },

      showAllTracks: (projectId) => {
        set((state) => ({
          hiddenTrackIdsByProject: { ...state.hiddenTrackIdsByProject, [projectId]: [] },
        }));
      },

      unhideAncestorChain: (projectId, trackPathIds) => {
        set((state) => {
          const current = state.hiddenTrackIdsByProject[projectId] ?? [];
          const remove = new Set(trackPathIds);
          const next = current.filter((id) => !remove.has(id));
          if (next.length === current.length) return state;
          return {
            hiddenTrackIdsByProject: { ...state.hiddenTrackIdsByProject, [projectId]: next },
          };
        });
      },

      pruneHiddenTracks: (projectId, existingTrackIds) => {
        set((state) => {
          const current = state.hiddenTrackIdsByProject[projectId] ?? [];
          const next = current.filter((id) => existingTrackIds.has(id));
          if (next.length === current.length) return state;
          return {
            hiddenTrackIdsByProject: { ...state.hiddenTrackIdsByProject, [projectId]: next },
          };
        });
      },

      setDismissedWarningsKey: (key) => set({ dismissedWarningsKey: key }),
    }),
    {
      name: 'timeline-ui',
      partialize: (state) => ({ hiddenTrackIdsByProject: state.hiddenTrackIdsByProject }),
    }
  )
);

export default useTimelineUiStore;

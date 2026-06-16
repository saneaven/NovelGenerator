import { create } from 'zustand';
import type { Asset } from '../api/assetService';

export interface Project {
  id: string;
  name: string;
  description?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  cover_asset?: Asset | null;  // From BasicInfo's cover image
}

/**
 * Slim client selection store: the currently-open project id (persisted to
 * localStorage). The project LIST + CRUD moved to TanStack Query (`data/projects`).
 * This is the seed of the Step-7 `selectionStore`; it keeps the `useProjectStore`
 * name + `currentProjectId`/`setCurrentProject` API so the many call sites that
 * only read the selection stay untouched.
 */
interface ProjectSelectionStore {
  currentProjectId: string | null;
  setCurrentProject: (id: string | null) => void;
}

export const useProjectStore = create<ProjectSelectionStore>()((set) => ({
  currentProjectId: null,

  setCurrentProject: (id: string | null) => {
    set({ currentProjectId: id });
    // Persist current project ID for restoration across reloads.
    if (id) {
      localStorage.setItem('currentProjectId', id);
    } else {
      localStorage.removeItem('currentProjectId');
    }
  },
}));

// Initialize current project from localStorage
const storedProjectId = localStorage.getItem('currentProjectId');
if (storedProjectId) {
  useProjectStore.setState({ currentProjectId: storedProjectId });
}

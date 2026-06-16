import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Asset } from '../api/assetService';

export interface Project {
  id: string;
  name: string;
  description?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  cover_asset?: Asset | null; // From BasicInfo's cover image
}

/**
 * Consolidated client selection store: what the user currently has selected.
 * Pure client state (server lists/CRUD live in TanStack Query):
 *   - currentProjectId       (localStorage 'currentProjectId')
 *   - selectedAgentByProject (localStorage 'selectedAgent_<projectId>'; hydrated by useEnsureAgentSelection)
 *   - preferredDisplayLanguage (persisted via the 'display-language-storage' key)
 *
 * Field names match the former projectStore / agentStore / displayLanguageStore so
 * consumers only swap the hook, and the existing localStorage keys are preserved.
 */
interface SelectionStore {
  currentProjectId: string | null;
  setCurrentProject: (id: string | null) => void;

  selectedAgentByProject: Record<string, string | undefined>;
  selectAgent: (projectId: string, agentId: string) => void;
  getSelectedAgentId: (projectId: string) => string | undefined;

  preferredDisplayLanguage: string | null;
  setPreferredDisplayLanguage: (language: string | null) => void;
}

export const useSelectionStore = create<SelectionStore>()(
  persist(
    (set, get) => ({
      currentProjectId: null,
      setCurrentProject: (id) => {
        set({ currentProjectId: id });
        // Persist current project ID for restoration across reloads.
        if (id) {
          localStorage.setItem('currentProjectId', id);
        } else {
          localStorage.removeItem('currentProjectId');
        }
      },

      selectedAgentByProject: {},
      selectAgent: (projectId, agentId) => {
        set((state) => ({
          selectedAgentByProject: { ...state.selectedAgentByProject, [projectId]: agentId },
        }));
        localStorage.setItem(`selectedAgent_${projectId}`, agentId);
      },
      getSelectedAgentId: (projectId) => get().selectedAgentByProject[projectId],

      preferredDisplayLanguage: null,
      setPreferredDisplayLanguage: (language) => set({ preferredDisplayLanguage: language }),
    }),
    {
      // Keep the original key/shape so existing display-language preferences survive.
      name: 'display-language-storage',
      partialize: (state) => ({ preferredDisplayLanguage: state.preferredDisplayLanguage }),
    },
  ),
);

// Restore the current project id (manual key, matching the former projectStore).
const storedProjectId = localStorage.getItem('currentProjectId');
if (storedProjectId) {
  useSelectionStore.setState({ currentProjectId: storedProjectId });
}

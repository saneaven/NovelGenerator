import { create } from 'zustand';

/**
 * Slim client selection store: which agent is selected, per project (persisted
 * to localStorage). The agent LIST + CRUD moved to TanStack Query
 * (`data/agents`); the fetch-time auto-select/auto-create reconciliation moved
 * to `useEnsureAgentSelection`. This keeps the `useAgentStore` name +
 * `selectAgent`/`getSelectedAgentId` API so the selection call sites stay
 * untouched. Folds into the Step-7 `selectionStore` alongside `currentProjectId`.
 */
interface AgentSelectionStore {
  selectedAgentByProject: Record<string, string | undefined>;
  selectAgent: (projectId: string, agentId: string) => void;
  getSelectedAgentId: (projectId: string) => string | undefined;
}

export const useAgentStore = create<AgentSelectionStore>()((set, get) => ({
  selectedAgentByProject: {},

  selectAgent: (projectId: string, agentId: string) => {
    set((state) => ({
      selectedAgentByProject: {
        ...state.selectedAgentByProject,
        [projectId]: agentId,
      },
    }));
    localStorage.setItem(`selectedAgent_${projectId}`, agentId);
  },

  getSelectedAgentId: (projectId: string) => get().selectedAgentByProject[projectId],
}));

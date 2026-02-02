import { create } from 'zustand';
import { subAgentService } from '../api/subAgentService';
import type { SubAgentCreate, SubAgentDefinition, SubAgentUpdate } from '../types/subAgents';

interface SubAgentState {
  subAgents: SubAgentDefinition[];
  isLoading: boolean;
  error: string | null;
}

interface SubAgentActions {
  loadSubAgents: () => Promise<void>;
  createSubAgent: (data: SubAgentCreate) => Promise<SubAgentDefinition>;
  updateSubAgent: (subAgentId: string, data: SubAgentUpdate) => Promise<SubAgentDefinition>;
  deleteSubAgent: (subAgentId: string) => Promise<void>;
  getById: (subAgentId: string) => SubAgentDefinition | undefined;
}

export const useSubAgentStore = create<SubAgentState & SubAgentActions>((set, get) => ({
  subAgents: [],
  isLoading: false,
  error: null,

  loadSubAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const subAgents = await subAgentService.list();
      set({ subAgents, isLoading: false });
    } catch (error) {
      set({ isLoading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  createSubAgent: async (data) => {
    const created = await subAgentService.create(data);
    set((state) => ({ subAgents: [...state.subAgents, created] }));
    return created;
  },

  updateSubAgent: async (subAgentId, data) => {
    const updated = await subAgentService.update(subAgentId, data);
    set((state) => ({
      subAgents: state.subAgents.map((s) => (s.sub_agent_id === subAgentId ? updated : s)),
    }));
    return updated;
  },

  deleteSubAgent: async (subAgentId) => {
    await subAgentService.delete(subAgentId);
    set((state) => ({
      subAgents: state.subAgents.filter((s) => s.sub_agent_id !== subAgentId),
    }));
  },

  getById: (subAgentId) => get().subAgents.find((s) => s.sub_agent_id === subAgentId),
}));


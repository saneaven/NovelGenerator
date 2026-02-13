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
  ensureLoaded: () => Promise<void>;
  createSubAgent: (data: SubAgentCreate) => Promise<SubAgentDefinition>;
  updateSubAgent: (id: string, data: SubAgentUpdate) => Promise<SubAgentDefinition>;
  deleteSubAgent: (id: string) => Promise<void>;
  getById: (id: string) => SubAgentDefinition | undefined;
  getByAgentName: (agentName: string) => SubAgentDefinition | undefined;
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

  ensureLoaded: async () => {
    if (get().subAgents.length > 0) return;
    if (get().isLoading) {
      await new Promise<void>((resolve) => {
        const unsub = useSubAgentStore.subscribe((s) => {
          if (!s.isLoading) {
            unsub();
            resolve();
          }
        });
      });
      return;
    }
    await get().loadSubAgents();
  },

  createSubAgent: async (data) => {
    const created = await subAgentService.create(data);
    set((state) => ({ subAgents: [...state.subAgents, created] }));
    return created;
  },

  updateSubAgent: async (subAgentId, data) => {
    const updated = await subAgentService.update(subAgentId, data);
    set((state) => ({
      subAgents: state.subAgents.map((s) => (s.id === subAgentId ? updated : s)),
    }));
    return updated;
  },

  deleteSubAgent: async (subAgentId) => {
    await subAgentService.delete(subAgentId);
    set((state) => ({
      subAgents: state.subAgents.filter((s) => s.id !== subAgentId),
    }));
  },

  getById: (subAgentId) => get().subAgents.find((s) => s.id === subAgentId),
  getByAgentName: (agentName) => get().subAgents.find((s) => s.agent_name === agentName),
}));

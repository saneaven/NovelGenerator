import { create } from 'zustand';
import { agentService, type AgentResponse } from '../api';

export interface Agent {
  id: string;
  name: string;
  project_id: string;
  thread_id?: string | null;
  archived_until_message_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function getAgentLastActivityAt(agent: Agent): Date {
  const updatedAt = new Date(agent.updated_at);
  if (!Number.isNaN(updatedAt.getTime())) return updatedAt;

  const createdAt = new Date(agent.created_at);
  if (!Number.isNaN(createdAt.getTime())) return createdAt;

  return new Date(0);
}

function sortAgentsByLastActivity(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aLast = getAgentLastActivityAt(a).getTime();
    const bLast = getAgentLastActivityAt(b).getTime();
    if (aLast !== bLast) return bLast - aLast;

    const aCreated = new Date(a.created_at).getTime();
    const bCreated = new Date(b.created_at).getTime();
    if (aCreated !== bCreated) return bCreated - aCreated;

    return a.id.localeCompare(b.id);
  });
}

const convertBackendAgent = (agent: AgentResponse): Agent => ({
  id: agent.id,
  name: agent.name,
  project_id: agent.project_id,
  thread_id: (agent as any).thread_id ?? null,
  archived_until_message_id: (agent as any).archived_until_message_id ?? null,
  created_at: agent.created_at,
  updated_at: agent.updated_at,
});

interface AgentStore {
  agentsByProject: Record<string, Agent[]>;
  selectedAgentByProject: Record<string, string | undefined>;
  isLoading: boolean;
  error: string | null;

  fetchAgents: (projectId: string) => Promise<void>;
  createAgent: (projectId: string, name?: string) => Promise<string>;
  getAgents: (projectId: string) => Agent[];
  getAgent: (projectId: string, agentId: string) => Agent | undefined;
  selectAgent: (projectId: string, agentId: string) => void;
  getSelectedAgentId: (projectId: string) => string | undefined;
  getSelectedAgent: (projectId: string) => Agent | undefined;
  renameAgent: (projectId: string, agentId: string, name: string) => Promise<void>;
  deleteAgent: (projectId: string, agentId: string) => Promise<void>;
  setArchivedUntilMessageId: (projectId: string, agentId: string, messageId: string | null) => void;

  clearProject: (projectId: string) => void;
  clearError: () => void;
}

export const useAgentStore = create<AgentStore>()((set, get) => ({
  agentsByProject: {},
  selectedAgentByProject: {},
  isLoading: false,
  error: null,

  fetchAgents: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendAgents = await agentService.listAgents(projectId);
      const unsortedAgents = Array.isArray(backendAgents) ? backendAgents.map(convertBackendAgent) : [];
      const agents = sortAgentsByLastActivity(unsortedAgents);

      const storedAgentId = localStorage.getItem(`selectedAgent_${projectId}`);
      const validStoredAgentId = storedAgentId && agents.some(agent => agent.id === storedAgentId)
        ? storedAgentId
        : undefined;

      if (storedAgentId && !validStoredAgentId) {
        localStorage.removeItem(`selectedAgent_${projectId}`);
      }

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]: agents,
        },
        ...(validStoredAgentId && {
          selectedAgentByProject: {
            ...state.selectedAgentByProject,
            [projectId]: validStoredAgentId,
          },
        }),
        isLoading: false,
      }));

      if (agents.length === 0) {
        await get().createAgent(projectId, 'Main Agent');
      } else if (!validStoredAgentId) {
        get().selectAgent(projectId, agents[0].id);
      }
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch agents',
      });
    }
  },

  createAgent: async (projectId: string, name?: string) => {
    set({ isLoading: true, error: null });
    try {
      const agentName = name || `Agent ${(get().agentsByProject[projectId] || []).length + 1}`;
      const backendAgent = await agentService.createAgent(projectId, { name: agentName });
      const agent = convertBackendAgent(backendAgent);

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]: sortAgentsByLastActivity([...(state.agentsByProject[projectId] || []), agent]),
        },
        selectedAgentByProject: {
          ...state.selectedAgentByProject,
          [projectId]: agent.id,
        },
        isLoading: false,
      }));

      localStorage.setItem(`selectedAgent_${projectId}`, agent.id);

      return agent.id;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create agent',
      });
      throw error;
    }
  },

  getAgents: (projectId: string) => get().agentsByProject[projectId] || [],

  getAgent: (projectId: string, agentId: string) => {
    const agents = get().agentsByProject[projectId] || [];
    return agents.find((agent) => agent.id === agentId);
  },

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

  getSelectedAgent: (projectId: string) => {
    const selectedAgentId = get().getSelectedAgentId(projectId);
    if (selectedAgentId) {
      return get().getAgent(projectId, selectedAgentId);
    }
    return undefined;
  },

  renameAgent: async (projectId: string, agentId: string, name: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendAgent = await agentService.updateAgent(projectId, agentId, { name });
      const agent = convertBackendAgent(backendAgent);

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]:
            state.agentsByProject[projectId]?.map((a) => (a.id === agentId ? agent : a)) || [],
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to rename agent',
      });
      throw error;
    }
  },

  setArchivedUntilMessageId: (projectId: string, agentId: string, messageId: string | null) => {
    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]:
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId ? { ...agent, archived_until_message_id: messageId } : agent
          ) || [],
      },
    }));
  },

  deleteAgent: async (projectId: string, agentId: string) => {
    set({ isLoading: true, error: null });
    try {
      await agentService.deleteAgent(projectId, agentId);
      const agents = get().agentsByProject[projectId] || [];
      const filteredAgents = agents.filter((agent) => agent.id !== agentId);

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]: filteredAgents,
        },
        selectedAgentByProject: {
          ...state.selectedAgentByProject,
          [projectId]: filteredAgents.length > 0 ? filteredAgents[0].id : undefined,
        },
        isLoading: false,
      }));

      if (filteredAgents.length > 0) {
        localStorage.setItem(`selectedAgent_${projectId}`, filteredAgents[0].id);
      } else {
        localStorage.removeItem(`selectedAgent_${projectId}`);
      }
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete agent',
      });
      throw error;
    }
  },

  clearProject: (projectId: string) => {
    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]: [],
      },
      selectedAgentByProject: {
        ...state.selectedAgentByProject,
        [projectId]: undefined,
      },
    }));
  },

  clearError: () => set({ error: null }),
}));

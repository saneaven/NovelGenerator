import { create } from 'zustand';
import { mcpService } from '../api/mcpService';
import type {
  McpServerCreate,
  McpServerResponse,
  McpServerUpdate,
} from '../types/mcp';

interface McpStore {
  servers: McpServerResponse[];
  loadedPresetId: string | null;
  isLoading: boolean;
  error: string | null;
  loadServers: (presetId: string) => Promise<void>;
  ensureLoaded: (presetId: string) => Promise<void>;
  createServer: (presetId: string, data: McpServerCreate) => Promise<McpServerResponse>;
  updateServer: (presetId: string, serverId: string, data: McpServerUpdate) => Promise<McpServerResponse>;
  deleteServer: (presetId: string, serverId: string) => Promise<void>;
  syncServer: (presetId: string, serverId: string) => Promise<McpServerResponse>;
  reset: () => void;
}

export const useMcpStore = create<McpStore>()((set, get) => ({
  servers: [],
  loadedPresetId: null,
  isLoading: false,
  error: null,

  loadServers: async (presetId) => {
    set({ isLoading: true, error: null });
    try {
      const servers = await mcpService.list(presetId);
      set({ servers, loadedPresetId: presetId, isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load MCP servers',
      });
      throw error;
    }
  },

  ensureLoaded: async (presetId) => {
    if (!presetId) return;
    if (get().loadedPresetId === presetId && get().servers.length >= 0) {
      return;
    }
    await get().loadServers(presetId);
  },

  createServer: async (presetId, data) => {
    const created = await mcpService.create(presetId, data);
    set((state) => ({
      servers: [...state.servers, created].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }));
    return created;
  },

  updateServer: async (presetId, serverId, data) => {
    const updated = await mcpService.update(presetId, serverId, data);
    set((state) => ({
      servers: state.servers
        .map((server) => (server.id === serverId ? updated : server))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }));
    return updated;
  },

  deleteServer: async (presetId, serverId) => {
    await mcpService.delete(presetId, serverId);
    set((state) => ({
      servers: state.servers.filter((server) => server.id !== serverId),
    }));
  },

  syncServer: async (presetId, serverId) => {
    const updated = await mcpService.sync(presetId, serverId);
    set((state) => ({
      servers: state.servers
        .map((server) => (server.id === serverId ? updated : server))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }));
    return updated;
  },

  reset: () => set({ servers: [], loadedPresetId: null, isLoading: false, error: null }),
}));

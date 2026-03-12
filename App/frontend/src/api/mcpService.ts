import { apiClient } from './client';
import type {
  McpServerCreate,
  McpServerResponse,
  McpServerUpdate,
} from '../types/mcp';

export const mcpService = {
  async list(presetId: string): Promise<McpServerResponse[]> {
    return await apiClient.get<McpServerResponse[]>(`/api/v1/presets/${encodeURIComponent(presetId)}/mcp-servers`);
  },

  async create(presetId: string, data: McpServerCreate): Promise<McpServerResponse> {
    return await apiClient.post<McpServerResponse>(
      `/api/v1/presets/${encodeURIComponent(presetId)}/mcp-servers`,
      data,
    );
  },

  async update(presetId: string, serverId: string, data: McpServerUpdate): Promise<McpServerResponse> {
    return await apiClient.patch<McpServerResponse>(
      `/api/v1/presets/${encodeURIComponent(presetId)}/mcp-servers/${encodeURIComponent(serverId)}`,
      data,
    );
  },

  async delete(presetId: string, serverId: string): Promise<void> {
    await apiClient.delete(
      `/api/v1/presets/${encodeURIComponent(presetId)}/mcp-servers/${encodeURIComponent(serverId)}`,
    );
  },

  async sync(presetId: string, serverId: string): Promise<McpServerResponse> {
    return await apiClient.post<McpServerResponse>(
      `/api/v1/presets/${encodeURIComponent(presetId)}/mcp-servers/${encodeURIComponent(serverId)}/sync`,
    );
  },
};

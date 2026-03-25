/**
 * API service for Sub Agents (per active preset)
 */
import { apiClient } from './client';
import type {
  SubAgentCreatePayload,
  SubAgentDefinition,
  SubAgentToolGrantCatalogItem,
  SubAgentUpdate,
} from '../types/subAgents';

const BASE_PATH = '/api/v1/sub_agents';

export const subAgentService = {
  async list(): Promise<SubAgentDefinition[]> {
    return await apiClient.get<SubAgentDefinition[]>(BASE_PATH);
  },

  async create(data: SubAgentCreatePayload): Promise<SubAgentDefinition> {
    return await apiClient.post<SubAgentDefinition>(BASE_PATH, data);
  },

  async update(id: string, data: SubAgentUpdate): Promise<SubAgentDefinition> {
    return await apiClient.put<SubAgentDefinition>(`${BASE_PATH}/${encodeURIComponent(id)}`, data);
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/${encodeURIComponent(id)}`);
  },

  async listToolGrantCatalog(): Promise<SubAgentToolGrantCatalogItem[]> {
    return await apiClient.get<SubAgentToolGrantCatalogItem[]>(`${BASE_PATH}/tool_grants_catalog`);
  },
};

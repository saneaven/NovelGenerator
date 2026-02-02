/**
 * API service for Sub Agents (per active preset)
 */
import { apiClient } from './client';
import type { SubAgentCreate, SubAgentDefinition, SubAgentUpdate } from '../types/subAgents';

const BASE_PATH = '/api/v1/sub_agents';

export const subAgentService = {
  async list(): Promise<SubAgentDefinition[]> {
    return await apiClient.get<SubAgentDefinition[]>(BASE_PATH);
  },

  async create(data: SubAgentCreate): Promise<SubAgentDefinition> {
    return await apiClient.post<SubAgentDefinition>(BASE_PATH, data);
  },

  async update(subAgentId: string, data: SubAgentUpdate): Promise<SubAgentDefinition> {
    return await apiClient.put<SubAgentDefinition>(`${BASE_PATH}/${encodeURIComponent(subAgentId)}`, data);
  },

  async delete(subAgentId: string): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/${encodeURIComponent(subAgentId)}`);
  },
};


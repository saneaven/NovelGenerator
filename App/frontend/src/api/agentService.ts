/**
 * Agent service
 */

import apiClient from './client';
import type {
  AgentCreate,
  AgentUpdate,
  AgentResponse,
} from './types';

export const agentService = {
  /**
   * Create a new agent
   */
  async createAgent(projectId: string, data: AgentCreate): Promise<AgentResponse> {
    return apiClient.post<AgentResponse>(`/api/v1/projects/${projectId}/agents`, data);
  },

  /**
   * Get all agents for a project
   */
  async listAgents(projectId: string): Promise<AgentResponse[]> {
    return apiClient.get<AgentResponse[]>(`/api/v1/projects/${projectId}/agents`);
  },

  /**
   * Get a specific agent
   */
  async getAgent(projectId: string, agentId: string): Promise<AgentResponse> {
    return apiClient.get<AgentResponse>(`/api/v1/projects/${projectId}/agents/${agentId}`);
  },

  /**
   * Update agent
   */
  async updateAgent(
    projectId: string,
    agentId: string,
    data: AgentUpdate
  ): Promise<AgentResponse> {
    return apiClient.put<AgentResponse>(
      `/api/v1/projects/${projectId}/agents/${agentId}`,
      data
    );
  },

  /**
   * Delete agent
   */
  async deleteAgent(projectId: string, agentId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/projects/${projectId}/agents/${agentId}`);
  },
};

export default agentService;
